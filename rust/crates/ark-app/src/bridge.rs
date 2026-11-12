//! The link to the runtime child: starts it, reads its events on a background thread and writes commands.
//! One line is one JSON message (docs/island-protocol.md, section 1).

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command as Process, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use ark_protocol::{Command, Event};

/// What the background thread hands to the UI thread.
#[derive(Debug, Clone, PartialEq)]
pub enum Inbound {
    Event(Box<Event>),
    /// The child ended. The text says how, in words for the user.
    Down(String),
}

/// Called after the thread queues something, so the window redraws (Rune's `Waker`).
pub type Wake = Arc<dyn Fn() + Send + Sync>;

pub struct Bridge {
    out: Sender<String>,
    inbox: Arc<Mutex<Vec<Inbound>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Words for the way a child ended. Exit codes are in docs/island-protocol.md, section 2.
pub fn exit_words(code: Option<i32>) -> String {
    match code {
        Some(0) => "The runtime quit.".into(),
        Some(78) => "The runtime needs configuration (exit 78). Check the .env file.".into(),
        Some(75) => "Another runtime owns this data folder (exit 75).".into(),
        Some(c) => format!("The runtime stopped (exit {c})."),
        None => "The runtime was stopped by a signal.".into(),
    }
}

impl Bridge {
    /// Starts `program args...` with a pipe on each side. Its stderr goes to ours.
    pub fn spawn(program: &str, args: &[String], cwd: Option<&std::path::Path>, wake: Wake) -> std::io::Result<Bridge> {
        let mut process = Process::new(program);
        if let Some(dir) = cwd {
            process.current_dir(dir);
        }
        let mut child: Child = process.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
        let (stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
            (Some(i), Some(o)) => (i, o),
            _ => return Err(std::io::Error::other("the runtime has no pipes")),
        };
        let inbox = Arc::new(Mutex::new(Vec::new()));
        let (out, lines) = mpsc::channel::<String>();

        thread::spawn(move || {
            let mut stdin = stdin;
            // The loop ends when the Bridge drops its Sender: stdin closes and the runtime exits.
            for line in lines {
                if stdin.write_all(line.as_bytes()).and_then(|()| stdin.flush()).is_err() {
                    break;
                }
            }
        });

        let queue = Arc::clone(&inbox);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                // A line that is not a JSON object is a runtime bug: skip it, never stop reading.
                if let Ok(event) = Event::parse(&line) {
                    lock(&queue).push(Inbound::Event(Box::new(event)));
                    wake();
                }
            }
            let code = child.wait().ok().and_then(|s| s.code());
            lock(&queue).push(Inbound::Down(exit_words(code)));
            wake();
        });
        Ok(Bridge { out, inbox })
    }

    /// Queues one command. A command after the child ended is dropped.
    pub fn send(&self, command: &Command) {
        // A send fails only after the writer thread ended with the child: nothing is left to tell.
        self.out.send(command.to_line()).ok();
    }

    /// A typed message to the open chat (`text.send`).
    pub fn send_text(&self, text: &str) {
        self.send(&Command::TextSend { text: text.to_owned(), files: None, notes: None, request: None, chat: None });
    }

    /// The user's answer to an `approval.request`.
    pub fn answer(&self, id: &str, approved: bool) {
        self.send(&Command::ApprovalAnswer { id: id.to_owned(), approved, remember_file: None, remember_task: None, review_token: None });
    }

    /// Takes every message that arrived since the last call, oldest first.
    pub fn drain(&self) -> Vec<Inbound> {
        std::mem::take(&mut *lock(&self.inbox))
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.send(&Command::Quit);
    }
}
