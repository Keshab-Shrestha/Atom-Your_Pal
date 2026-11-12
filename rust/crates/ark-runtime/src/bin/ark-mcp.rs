//! `ark-mcp`: ARK as an MCP server over stdio. stdout carries only MCP messages.
//!   claude mcp add ark -- /path/to/ark-mcp

use std::io::{BufRead, Write};

use ark_runtime::mcp;

fn main() {
    let folder = std::env::current_dir().unwrap_or_default();
    let api = mcp::api_from_environment(&folder, |name| std::env::var(name).ok());
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if let Some(answer) = mcp::handle(&line, &api)
            && out.write_all(answer.as_bytes()).and_then(|()| out.flush()).is_err()
        {
            break;
        }
    }
}
