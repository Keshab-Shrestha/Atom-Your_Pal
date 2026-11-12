//! The workspace terminal (WorkspaceTerminalSession.swift). One shell command at a time runs in the project folder,
//! its output (stdout and stderr) fills a bounded list of lines. This is a command runner, not a full terminal:
//! no PTY, so programs that need a screen (vim, top) do not work. The owner types the command, as in Swift.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// The lines kept. Older lines drop first.
const MAX_LINES: usize = 2000;

#[derive(Debug, Default)]
pub struct Output {
    pub lines: Vec<String>,
    pub running: bool,
    /// The exit code after the command ends; None while it runs or after a kill.
    pub code: Option<i32>,
    /// Counts changes, so the window knows to redraw.
    pub version: u64,
}

#[derive(Default)]
pub struct Terminal {
    pub out: Arc<Mutex<Output>>,
    child: Arc<Mutex<Option<Child>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn push(out: &Mutex<Output>, line: String) {
    let mut o = lock(out);
    o.lines.push(line);
    if o.lines.len() > MAX_LINES {
        o.lines.remove(0);
    }
    o.version += 1;
}

impl Terminal {
    pub fn snapshot(&self) -> (Vec<String>, bool, Option<i32>, u64) {
        let o = lock(&self.out);
        (o.lines.clone(), o.running, o.code, o.version)
    }

    /// Runs `command` with the login shell in `cwd`. A running command stops first.
    /// `wake` redraws the window when output arrives.
    pub fn run(&self, cwd: &str, command: &str, wake: Option<rune::Waker>) -> Result<(), String> {
        self.stop();
        let mut child = Command::new("/bin/zsh").args(["-lc", &format!("{{ {command}\n}} 2>&1")]).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("The shell did not start: {e}"))?;
        let stdout = child.stdout.take();
        {
            let mut o = lock(&self.out);
            o.lines.push(format!("$ {command}"));
            o.running = true;
            o.code = None;
            o.version += 1;
        }
        *lock(&self.child) = Some(child);
        let (out, slot) = (Arc::clone(&self.out), Arc::clone(&self.child));
        std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    push(&out, line);
                    if let Some(w) = &wake {
                        w();
                    }
                }
            }
            let code = lock(&slot).take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
            let mut o = lock(&out);
            o.running = false;
            o.code = code;
            o.version += 1;
            drop(o);
            if let Some(w) = &wake {
                w();
            }
        });
        Ok(())
    }

    /// Kills the running command, if any.
    pub fn stop(&self) {
        if let Some(child) = lock(&self.child).as_mut() {
            drop(child.kill());
        }
    }

    pub fn clear(&self) {
        let mut o = lock(&self.out);
        o.lines.clear();
        o.version += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_done(t: &Terminal) -> Vec<String> {
        for _ in 0..200 {
            let (lines, running, ..) = t.snapshot();
            if !running && lines.len() > 1 {
                return lines;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        t.snapshot().0
    }

    #[test]
    fn a_command_runs_in_the_folder_and_its_errors_show_too() {
        let dir = std::env::temp_dir();
        let t = Terminal::default();
        assert!(t.run(&dir.to_string_lossy(), "echo hi; echo oops >&2; exit 3", None).is_ok());
        let lines = wait_done(&t);
        assert_eq!(lines[..3], ["$ echo hi; echo oops >&2; exit 3".to_owned(), "hi".into(), "oops".into()]);
        for _ in 0..100 {
            if t.snapshot().2.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(t.snapshot().2, Some(3));
    }

    #[test]
    fn a_missing_folder_is_an_error_not_a_panic() {
        assert!(Terminal::default().run("/no/such/folder/ark", "true", None).is_err());
    }
}
