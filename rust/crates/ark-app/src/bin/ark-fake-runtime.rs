//! `ark-fake-runtime [script.jsonl]`: speaks the island protocol from a script (see `ark_app::fake`).
//! It stands in for the runtime in tests. Without a script it sends `ready` and nothing else.

use ark_app::fake::{self, Script};

fn main() {
    let text = std::env::args().nth(1).map(|path| std::fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("ark-fake-runtime: {path}: {e}");
        std::process::exit(2);
    }));
    let script = Script::parse(text.as_deref().unwrap_or(r#"{"type":"ready","protocol":1,"provider":"fake","model":"fake","microphone":"none","voice":false}"#));
    if let Err(e) = fake::run(&script, std::io::stdin().lock(), std::io::stdout().lock()) {
        eprintln!("ark-fake-runtime: {e}");
    }
}
