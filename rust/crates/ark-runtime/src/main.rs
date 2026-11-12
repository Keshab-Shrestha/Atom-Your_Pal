//! `ark-runtime <program> [args...]`: Phase 2 of ADR-278, a forwarder that answers some commands itself.
//!
//! It starts `<program>` (the Node runtime) with the same working folder and environment, then copies
//! every stdin line to the child and every child stdout line back, byte for byte. Exception: a read-only
//! command that `native::Native` can answer (`brain.note`, `brain.search`) gets its answer from the data
//! file at once and does not reach the child. `ARK_RUNTIME_NATIVE=0` turns that off. The child's stderr is
//! inherited. Blocking writes give back-pressure; lines have no length limit. SIGTERM, SIGINT, SIGHUP and
//! SIGQUIT go to the child. The forwarder exits with the child's exit code, or dies by the child's signal.

use ark_runtime::native;

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::thread;

/// The child's pid for the signal handler; 0 before the start.
static CHILD_PID: AtomicI32 = AtomicI32::new(0);
const FORWARDED_SIGNALS: [libc::c_int; 4] = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP, libc::SIGQUIT];
/// The shell's convention when a program cannot be started.
const EXIT_CANNOT_START: i32 = 127;
const EXIT_USAGE: i32 = 2;

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
fn forward_lines(reader: impl BufRead, mut writer: impl Write) -> io::Result<()> {
    let mut reader = reader;
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        writer.write_all(&line)?;
        writer.flush()?;
    }
}

/// Like `forward_lines`, but a line that `native` answers goes to `out`, not to `writer`.
fn route_lines(reader: impl BufRead, mut writer: impl Write, native: Option<&native::Native>, mut out: impl Write) -> io::Result<()> {
    let mut reader = reader;
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
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
    let native = native_from_process();
    thread::spawn(move || route_lines(io::stdin().lock(), child_in, native.as_ref(), io::stdout()));
    let to_app = thread::spawn(move || {
        if forward_lines(BufReader::new(child_out), io::stdout()).is_err() {
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
