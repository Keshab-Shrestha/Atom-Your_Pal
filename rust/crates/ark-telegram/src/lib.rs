//! ARK's own Telegram bot over the Bot API (ADR-098), a port of `apps/mac/src/telegram.ts`.
//! One chat only. Every other chat, and every other sender in that chat, is ignored.
//! The token comes from the environment or the caller. The log callback gets event names and codes:
//! never message text, never the token.
#![forbid(unsafe_code)]

pub mod bot;
mod split;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::sync::watch;

pub use split::{MESSAGE_LIMIT, split_message};

const DEFAULT_API: &str = "https://api.telegram.org";
const POLL_SECONDS: u64 = 50;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);
const PARTIAL_KEEP: Duration = Duration::from_secs(15 * 60);
const PARTIAL_MAX: usize = 20;

/// One inline button. `data` is at most 64 bytes (Telegram's limit).
#[derive(Debug, Clone, PartialEq)]
pub struct Button {
    pub text: String,
    pub data: String,
}

/// What the owner sent: a text message, or a press on one of the bot's buttons.
#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    Text(String),
    Button { data: String, query_id: String },
}

pub type LogFn = Arc<dyn Fn(&str, &str) + Send + Sync>;

#[derive(Clone)]
pub struct Config {
    pub token: String,
    pub chat_id: String,
    /// The one person ARK obeys in that chat. Default: the chat id (a private chat). In a group nobody is obeyed without it.
    pub user_id: Option<String>,
    /// Skip what was sent while ARK was closed (default true).
    pub skip_backlog: bool,
    pub base_url: String,
    pub retry_delays: Vec<Duration>,
    pub first_backoff: Duration,
    /// The wait after a 401 (wrong token) or a 409 (another program reads the same bot).
    pub stuck_backoff: Duration,
    pub max_backoff: Duration,
    /// The long-poll wait of one getUpdates call.
    pub poll_seconds: u64,
    pub log: LogFn,
    pub on_backlog: Option<Arc<dyn Fn(usize) + Send + Sync>>,
}

impl Config {
    pub fn new(token: impl Into<String>, chat_id: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            chat_id: chat_id.into(),
            user_id: None,
            skip_backlog: true,
            base_url: DEFAULT_API.into(),
            retry_delays: vec![Duration::from_secs(1), Duration::from_secs(3), Duration::from_secs(9)],
            first_backoff: Duration::from_secs(1),
            stuck_backoff: Duration::from_secs(300),
            max_backoff: Duration::from_secs(60),
            poll_seconds: POLL_SECONDS,
            log: Arc::new(|_, _| {}),
            on_backlog: None,
        }
    }

    /// From `ARK_TELEGRAM_BOT_TOKEN` and `ARK_TELEGRAM_CHAT_ID` (and `ARK_TELEGRAM_USER_ID`). `None` unless both are set.
    pub fn from_env() -> Option<Self> {
        let get = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let mut cfg = Self::new(get("ARK_TELEGRAM_BOT_TOKEN")?, get("ARK_TELEGRAM_CHAT_ID")?);
        cfg.user_id = get("ARK_TELEGRAM_USER_ID");
        Some(cfg)
    }
}

#[derive(Debug)]
struct ApiError {
    code: i64,
    retry_after: Option<Duration>,
}

impl ApiError {
    /// A rate limit or a server error passes. A 4xx (blocked bot, wrong chat, bad message) fails again.
    fn transient(&self) -> bool {
        self.code == 429 || self.code >= 500
    }
}

pub struct Telegram {
    cfg: Config,
    http: reqwest::Client,
    stop: watch::Sender<bool>,
    partial: Mutex<HashMap<String, (usize, Instant)>>,
}

impl Telegram {
    /// Starts long polling in a task. `on_input` runs for each message or button press from the one person.
    /// It must not block (hand the input to a channel). Needs a running tokio runtime.
    pub fn start(cfg: Config, on_input: impl Fn(Input) + Send + Sync + 'static) -> Arc<Self> {
        let (stop, _) = watch::channel(false);
        let this = Arc::new(Self { cfg, http: reqwest::Client::new(), stop, partial: Mutex::new(HashMap::new()) });
        tokio::spawn(Arc::clone(&this).poll(on_input));
        (this.cfg.log)("telegram.start", "");
        this
    }

    /// Stops polling. A call in flight is dropped.
    pub fn stop(&self) {
        self.stop.send_replace(true);
        (self.cfg.log)("telegram.stop", "");
    }

    fn stopped(&self) -> bool {
        *self.stop.borrow()
    }

    async fn call(&self, method: &str, body: Value, timeout: Duration) -> Result<Value, ApiError> {
        let mut stop = self.stop.subscribe();
        let url = format!("{}/bot{}/{method}", self.cfg.base_url.trim_end_matches('/'), self.cfg.token);
        let request = async {
            let resp = self.http.post(url).json(&body).timeout(timeout).send().await.map_err(|_| ApiError { code: 0, retry_after: None })?;
            let status = i64::from(resp.status().as_u16());
            let json: Value = resp.json().await.unwrap_or(json!({"ok": false}));
            if json["ok"].as_bool() == Some(true) {
                return Ok(json["result"].clone());
            }
            let secs = json.pointer("/parameters/retry_after").and_then(Value::as_u64).filter(|s| *s > 0);
            Err(ApiError { code: json["error_code"].as_i64().unwrap_or(status), retry_after: secs.map(Duration::from_secs) })
        };
        tokio::select! {
            r = request => r,
            _ = stop.wait_for(|s| *s) => Err(ApiError { code: -1, retry_after: None }),
        }
    }

    fn sender_ok(&self, chat: Option<i64>, sender: Option<i64>) -> bool {
        let want = self.cfg.user_id.as_deref().unwrap_or(&self.cfg.chat_id);
        matches!((chat, sender), (Some(c), Some(s)) if c.to_string() == self.cfg.chat_id && s.to_string() == want)
    }

    async fn poll(self: Arc<Self>, on_input: impl Fn(Input) + Send + Sync) {
        let (mut offset, mut skipped, mut ignored) = (0_i64, 0_usize, 0_usize);
        let mut draining = self.cfg.skip_backlog;
        let mut backoff = self.cfg.first_backoff;
        let mut warned: Vec<i64> = Vec::new();
        while !self.stopped() {
            let body = json!({"offset": offset, "timeout": if draining { 0 } else { self.cfg.poll_seconds }, "allowed_updates": ["message", "callback_query"]});
            let timeout = Duration::from_secs(self.cfg.poll_seconds + 15);
            let updates = match self.call("getUpdates", body, timeout).await {
                Ok(v) => {
                    backoff = self.cfg.first_backoff;
                    v.as_array().cloned().unwrap_or_default()
                }
                Err(e) => {
                    if self.stopped() {
                        return;
                    }
                    let stuck = e.code == 401 || e.code == 409;
                    if stuck && !warned.contains(&e.code) {
                        warned.push(e.code);
                        let (name, hint) = if e.code == 401 { ("telegram.token_rejected", "make a new token with BotFather") } else { ("telegram.conflict", "another program reads this bot: give ARK its own bot") };
                        (self.cfg.log)(name, hint);
                    }
                    let wait = if stuck { self.cfg.stuck_backoff } else { backoff };
                    (self.cfg.log)("telegram.poll_failed", &format!("code={} retry_ms={}", e.code, wait.as_millis()));
                    self.sleep(wait).await;
                    backoff = (backoff * 2).min(self.cfg.max_backoff);
                    continue;
                }
            };
            if draining {
                for u in &updates {
                    offset = u["update_id"].as_i64().unwrap_or(offset - 1) + 1;
                    if self.sender_ok(chat_of(u), sender_of(u)) {
                        skipped += 1;
                    }
                }
                if updates.is_empty() {
                    draining = false;
                    if skipped > 0
                        && let Some(f) = &self.cfg.on_backlog
                    {
                        f(skipped);
                    }
                }
                continue;
            }
            for u in &updates {
                if self.stopped() {
                    return;
                }
                offset = u["update_id"].as_i64().unwrap_or(offset - 1) + 1;
                if !self.sender_ok(chat_of(u), sender_of(u)) {
                    ignored += 1;
                    (self.cfg.log)("telegram.ignored", &format!("count={ignored}"));
                } else if let Some(q) = u.get("callback_query") {
                    on_input(Input::Button { data: q["data"].as_str().unwrap_or_default().into(), query_id: q["id"].as_str().unwrap_or_default().into() });
                } else if let Some(m) = u.get("message") {
                    on_input(Input::Text(m["text"].as_str().unwrap_or_default().into()));
                }
            }
        }
    }

    /// Sleeps, but wakes at once on stop.
    async fn sleep(&self, d: Duration) {
        let mut stop = self.stop.subscribe();
        tokio::select! { _ = tokio::time::sleep(d) => {}, _ = stop.wait_for(|s| *s) => {} }
    }

    /// One part, tried again after a passing failure.
    async fn send_part(&self, body: Value) -> bool {
        for attempt in 0.. {
            let Err(e) = self.call("sendMessage", body.clone(), CALL_TIMEOUT).await else { return true };
            (self.cfg.log)("telegram.send_failed", &format!("code={} attempt={}", e.code, attempt + 1));
            let passing = if e.code == 0 { true } else { e.transient() }; // code 0: a network error
            let Some(delay) = self.cfg.retry_delays.get(attempt) else { return false };
            if self.stopped() || !passing {
                return false;
            }
            self.sleep((*delay).max(e.retry_after.unwrap_or_default()).min(MAX_RETRY_AFTER)).await;
            if self.stopped() {
                return false;
            }
        }
        false
    }

    /// Sends plain text (no Markdown), split at [`MESSAGE_LIMIT`]. Buttons go on the last part.
    /// True when every part was delivered. A long message that failed partway and is sent again starts after the parts Telegram has.
    pub async fn send(&self, text: &str, buttons: &[Vec<Button>]) -> bool {
        let parts = split_message(text);
        let key = format!("{text}\u{0}{}", buttons.iter().flatten().map(|b| format!("{}={}", b.text, b.data)).collect::<Vec<_>>().join(","));
        let from = match self.partial.lock().map(|m| m.get(&key).copied()) {
            Ok(Some((n, at))) if at.elapsed() < PARTIAL_KEEP && n < parts.len() => n,
            _ => 0,
        };
        for (i, part) in parts.iter().enumerate().skip(from) {
            let mut body = json!({"chat_id": self.cfg.chat_id, "text": part});
            if !buttons.is_empty() && i == parts.len() - 1 {
                let rows: Vec<Vec<Value>> = buttons.iter().map(|r| r.iter().map(|b| json!({"text": b.text, "callback_data": b.data})).collect()).collect();
                body["reply_markup"] = json!({"inline_keyboard": rows});
            }
            if !self.send_part(body).await {
                if parts.len() > 1
                    && let Ok(mut m) = self.partial.lock()
                {
                    m.insert(key, (i, Instant::now()));
                    let oldest = if m.len() > PARTIAL_MAX { m.iter().min_by_key(|(_, v)| v.1).map(|(k, _)| k.clone()) } else { None };
                    if let Some(oldest) = oldest {
                        m.remove(&oldest);
                    }
                }
                return false;
            }
        }
        if let Ok(mut m) = self.partial.lock() {
            m.remove(&key);
        }
        true
    }

    /// Ends a button's spinner, with a short toast.
    pub async fn answer(&self, query_id: &str, text: Option<&str>) {
        let mut body = json!({"callback_query_id": query_id});
        if let Some(t) = text {
            body["text"] = json!(t.chars().take(200).collect::<String>());
        }
        if let Err(e) = self.call("answerCallbackQuery", body, CALL_TIMEOUT).await {
            (self.cfg.log)("telegram.answer_failed", &format!("code={}", e.code));
        }
    }
}

fn chat_of(u: &Value) -> Option<i64> {
    u.pointer("/message/chat/id").or_else(|| u.pointer("/callback_query/message/chat/id")).and_then(Value::as_i64)
}

fn sender_of(u: &Value) -> Option<i64> {
    u.pointer("/message/from/id").or_else(|| u.pointer("/callback_query/from/id")).and_then(Value::as_i64)
}
