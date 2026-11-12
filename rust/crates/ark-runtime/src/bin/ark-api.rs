//! `ark-api`: the local HTTP API served by Rust alone (no Node). Run it in the ARK folder. It needs `ANTHROPIC_API_KEY` or
//! `ARK_CLAUDE_BRIDGE` for chat turns. `ARK_API_PORT` (default 4790) and `ARK_API_HOST` work as in Node. The token is `data/api-token`.
//! Do not run it while the Node runtime has the Local API on: both want the same port.

use std::net::TcpListener;
use std::sync::Arc;

use ark_runtime::api::{self, ChatBackend, DEFAULT_PORT, Server};
use ark_runtime::chat::Chat;
use ark_runtime::native::Native;

fn main() {
    let folder = std::env::current_dir().unwrap_or_default();
    let native = Native::from_environment(&folder, |name| std::env::var(name).ok());
    let Some(chat) = Chat::from_process_env(native.memory_db()) else {
        eprintln!("ark-api: set ANTHROPIC_API_KEY or ARK_CLAUDE_BRIDGE to answer chat turns");
        std::process::exit(2);
    };
    let token = match api::read_or_create_token(&folder.join("data/api-token")) {
        Ok(token) => token,
        Err(error) => {
            eprintln!("ark-api: {error}");
            std::process::exit(1);
        }
    };
    let port = std::env::var("ARK_API_PORT").ok().and_then(|p| p.trim().parse::<u16>().ok()).filter(|p| *p > 0).unwrap_or(DEFAULT_PORT);
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("ark-api: cannot listen on 127.0.0.1:{port}: {error}");
            std::process::exit(1);
        }
    };
    eprintln!("ark-api: listening on 127.0.0.1:{port}");
    let helpers = std::env::var("ARK_HELPERS_FILE").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "data/helpers.db".into());
    Server::with_helpers_db(token, std::env::var("ARK_API_HOST").ok().as_deref(), native.memory_db().to_path_buf(), Some(folder.join(helpers)), Arc::new(ChatBackend(chat))).serve(listener);
}
