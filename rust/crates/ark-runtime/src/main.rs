//! `ark-runtime <program> [args...]`: Phase 2 of ADR-278, a forwarder that answers some commands itself.
//!
//! It starts `<program>` (the Node runtime) with the same working folder and environment, then copies
//! every stdin line to the child and every child stdout line back, byte for byte. Exception: a read-only
//! command that `native::Native` can answer (`brain.note`, `brain.search`) gets its answer from the data
//! file at once and does not reach the child. `ARK_RUNTIME_NATIVE=0` turns that off. The child's stderr is
//! inherited. Blocking writes give back-pressure; lines have no length limit. SIGTERM, SIGINT, SIGHUP and
//! SIGQUIT go to the child. The forwarder exits with the child's exit code, or dies by the child's signal.

use ark_runtime::chat::{self, Chat, Sink};
use ark_runtime::native;

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

/// The child's pid for the signal handler; 0 before the start.
static CHILD_PID: AtomicI32 = AtomicI32::new(0);
const FORWARDED_SIGNALS: [libc::c_int; 4] = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP, libc::SIGQUIT];
/// The shell's convention when a program cannot be started.
const EXIT_CANNOT_START: i32 = 127;
const EXIT_USAGE: i32 = 2;
/// How often the change feed looks at the data file.
const FEED_INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);

extern "C" fn forward_signal(signal: libc::c_int) {
    let pid = CHILD_PID.load(Ordering::SeqCst);
    if pid > 0 {
        // SAFETY: kill(2) is async-signal-safe and takes plain integers.
        unsafe { libc::kill(pid, signal) };
    }
}

fn install_signal_forwarding() {
    for signal in FORWARDED_SIGNALS {
        // SAFETY: the handler only reads an atomic and calls kill(2), both async-signal-safe.
        unsafe { libc::signal(signal, forward_signal as *const () as libc::sighandler_t) };
    }
}

/// Copies `reader` to `writer` one line at a time and flushes after each line.
/// Returns at end of input or at the first error (the other side closed).
fn forward_lines(reader: impl BufRead, mut writer: impl Write, observe: impl Fn(&str)) -> io::Result<()> {
    let mut reader = reader;
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        if let Ok(text) = std::str::from_utf8(&line) {
            observe(text);
        }
        writer.write_all(&line)?;
        writer.flush()?;
    }
}

/// Like `forward_lines`, but a line that `native` answers goes to `out`, not to `writer`.
fn route_lines(reader: impl BufRead, mut writer: impl Write, native: Option<&native::Native>, chat: Option<(&Arc<Chat>, Sink, Sink)>, mut out: impl Write) -> io::Result<()> {
    let mut reader = reader;
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        if let (Some((chat, to_app, to_node)), Ok(text)) = (&chat, std::str::from_utf8(&line))
            && chat.handle(text, to_app.clone(), to_node.clone())
        {
            continue;
        }
        let answer = native.and_then(|n| std::str::from_utf8(&line).ok().and_then(|text| n.try_answer(text)));
        match answer {
            Some(reply) => {
                out.write_all(reply.as_bytes())?;
                out.flush()?;
            }
            None => {
                writer.write_all(&line)?;
                writer.flush()?;
            }
        }
    }
}

/// Writes `line` and flushes; a closed pipe is ignored (the forwarder ends on its own then).
fn write_line(out: &mut impl Write, line: &str) {
    out.write_all(line.as_bytes()).and_then(|()| out.flush()).ok();
}

/// A writer to Node's stdin that the stdin thread and the chat threads share.
struct SharedWriter(Arc<Mutex<std::process::ChildStdin>>);

impl Write for SharedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().map_err(|_| io::Error::other("lock poisoned"))?.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.lock().map_err(|_| io::Error::other("lock poisoned"))?.flush()
    }
}

fn chat_from_process(memory_db: &std::path::Path) -> Option<Arc<Chat>> {
    chat::enabled(|name| std::env::var(name).ok().filter(|v| !v.is_empty())).then(|| Chat::from_process_env(memory_db)).flatten()
}

fn native_from_process() -> Option<native::Native> {
    if std::env::var("ARK_RUNTIME_NATIVE").as_deref() == Ok("0") {
        return None;
    }
    let folder = std::env::current_dir().ok()?;
    Some(native::Native::from_environment(&folder, |name| std::env::var(name).ok()))
}

fn start(program: &str, args: &[String]) -> io::Result<Child> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

/// Ends this process the way the child ended.
fn exit_like(status: ExitStatus) -> ! {
    if let Some(code) = status.code() {
        std::process::exit(code);
    }
    if let Some(signal) = status.signal() {
        // SAFETY: resets one signal to its default action and raises it on this process.
        unsafe {
            libc::signal(signal, libc::SIG_DFL);
            libc::raise(signal);
        }
        std::process::exit(128 + signal);
    }
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((program, rest)) = args.split_first() else {
        eprintln!("usage: ark-runtime <program> [args...]");
        std::process::exit(EXIT_USAGE);
    };
    let mut child = match start(program, rest) {
        Ok(child) => child,
        Err(error) => {
            eprintln!("ark-runtime: cannot start {program}: {error}");
            std::process::exit(EXIT_CANNOT_START);
        }
    };
    CHILD_PID.store(child.id() as i32, Ordering::SeqCst);
    install_signal_forwarding();

    let (Some(child_in), Some(child_out)) = (child.stdin.take(), child.stdout.take()) else {
        eprintln!("ark-runtime: the child has no stdin or stdout pipe");
        std::process::exit(1);
    };
    // Stdin: when the app closes it (or the child stops reading), dropping `child_in` closes the child's stdin.
    // This thread is not joined: it can stay blocked on our stdin after the child exits.
    let native = native_from_process().map(std::sync::Arc::new);
    if let Some(native) = native.clone() {
        // The change feed: lines the app needs after Node changes the data file. Each line is one `write_all` on the locked stdout.
        thread::spawn(move || loop {
            thread::sleep(FEED_INTERVAL);
            for line in native.poll_changes() {
                let mut out = io::stdout().lock();
                if out.write_all(line.as_bytes()).and_then(|()| out.flush()).is_err() {
                    return;
                }
            }
        });
    }
    let node_in = Arc::new(Mutex::new(child_in));
    let chat = native.as_deref().and_then(|n| chat_from_process(n.memory_db()));
    let to_app: Sink = Arc::new(|line: &str| write_line(&mut io::stdout().lock(), line));
    let to_node: Sink = {
        // Weak: only the stdin thread owns the pipe, so its end closes Node's stdin.
        let node_in = Arc::downgrade(&node_in);
        Arc::new(move |line: &str| {
            if let Some(node_in) = node_in.upgrade()
                && let Ok(mut writer) = node_in.lock()
            {
                write_line(&mut *writer, line);
            }
        })
    };
    {
        let (native, chat, to_app) = (native.clone(), chat.clone(), to_app.clone());
        let to_node = to_node.clone();
        thread::spawn(move || {
            let writer = SharedWriter(node_in);
            let chat = chat.as_ref().map(|c| (c, to_app, to_node));
            route_lines(io::stdin().lock(), writer, native.as_deref(), chat, io::stdout())
        });
    }
    let to_app = thread::spawn(move || {
        let observe = |line: &str| {
            if let Some(chat) = &chat {
                chat.observe(line);
            }
        };
        if forward_lines(BufReader::new(child_out), io::stdout(), observe).is_err() {
            // The app closed our stdout: stop the child, as the app can no longer hear it.
            forward_signal(libc::SIGTERM);
        }
    });

    let status = match child.wait() {
        Ok(status) => status,
        Err(error) => {
            eprintln!("ark-runtime: wait failed: {error}");
            std::process::exit(1);
        }
    };
    // Send every line the child wrote before it exited.
    if to_app.join().is_err() {
        eprintln!("ark-runtime: the stdout thread panicked");
    }
    exit_like(status);
}
