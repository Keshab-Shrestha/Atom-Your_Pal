//! One process-wide event log: every window shows its tail, stdout gets each line.

use std::sync::{Mutex, OnceLock};

const KEEP: usize = 200;

static LINES: Mutex<(u64, Vec<String>)> = Mutex::new((0, Vec::new()));
static WAKE: OnceLock<rune::Waker> = OnceLock::new();

/// Wakes the main window's loop after a native callback logs, so it redraws.
pub fn set_waker(waker: rune::Waker) {
    WAKE.get_or_init(|| waker);
}

pub fn log(line: impl Into<String>) {
    let line = line.into();
    println!("spike: {line}");
    {
        let mut guard = LINES.lock().unwrap_or_else(|e| e.into_inner());
        guard.0 += 1;
        guard.1.push(line);
        if guard.1.len() > KEEP {
            guard.1.remove(0);
        }
    }
    if let Some(wake) = WAKE.get() {
        wake();
    }
}

/// How many lines were ever logged: a change means the view must redraw.
pub fn count() -> u64 {
    LINES.lock().unwrap_or_else(|e| e.into_inner()).0
}

pub fn tail(n: usize) -> Vec<String> {
    let guard = LINES.lock().unwrap_or_else(|e| e.into_inner());
    guard.1[guard.1.len().saturating_sub(n)..].to_vec()
}

/// A short, escaped form of user text for a log line.
pub fn short(s: &str) -> String {
    const MAX: usize = 60;
    let cut: String = s.chars().take(MAX).collect();
    let more = if s.chars().count() > MAX { "…" } else { "" };
    format!("{cut:?}{more}")
}

/// The log as a column of lines, newest last.
pub fn view(lines: usize, color: rune::Color) -> rune::El {
    let mut col = rune::col().key("log").gap(2.0).w_full();
    for line in tail(lines) {
        col = col.child(rune::text(line).font(rune::tok::type_::MONO_CAPTION).color(color));
    }
    col
}
