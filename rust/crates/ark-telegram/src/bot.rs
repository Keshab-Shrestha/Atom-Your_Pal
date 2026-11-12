//! The bot logic of `apps/mac/src/telegram-bot.ts` (ADR-098) on top of [`Telegram`]: commands, one ARK turn at a time with a
//! time limit, an outbox that tries a failed send again, ARK's questions with Allow and Decline buttons, and the push setting.
//! Not ported yet: the team parts (`/tasks`, `/report`, `/steer`, `/interrupt` and the Needs-you items of tasks, plans, proposals
//! and skills) because Rust has no helper store. Those commands answer "The team is not available." or "Steering is off.".
//! Logs names and counts only, never message text.

use std::collections::{HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{Button, Config, Input, LogFn, Telegram};

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

const REPLY_TURN_LIMIT: Duration = Duration::from_secs(10 * 60);
const PUSH_RETRY: Duration = Duration::from_secs(30);
const PUSH_TRIES: usize = 6;
const OUTBOX_MAX: usize = 20;
const NEEDS_SHOWN: usize = 10;

pub const HELP: &str = "I am ARK, your assistant. Send a message to talk to me.\n/needs: what waits for your answer\n/tasks: tasks that run or wait to run\n/report <number>: a task's report\n/steer <number> <text>: send a message to a task\n/help: this list";

/// One question from ARK that waits for the user.
#[derive(Debug, Clone, PartialEq)]
pub struct Ask {
    pub id: String,
    pub summary: String,
    pub reason: String,
}

/// What the bot needs from ARK. The runtime implements it with the agent loop and its approvals.
pub trait Brain: Send + Sync {
    /// One chat turn in the Telegram chat. Gives ARK's answer, or a reason it failed.
    fn ask(&self, text: String) -> BoxFut<'_, Result<String, String>>;
    fn pending_asks(&self) -> Vec<Ask>;
    fn answer_ask(&self, id: &str, approved: bool);
}

/// The Telegram side. [`Telegram`] is the real one.
pub trait Wire: Send + Sync {
    fn send<'a>(&'a self, text: &'a str, buttons: &'a [Vec<Button>]) -> BoxFut<'a, bool>;
    fn answer<'a>(&'a self, query_id: &'a str, text: &'a str) -> BoxFut<'a, ()>;
}

impl Wire for Telegram {
    fn send<'a>(&'a self, text: &'a str, buttons: &'a [Vec<Button>]) -> BoxFut<'a, bool> {
        Box::pin(Telegram::send(self, text, buttons))
    }
    fn answer<'a>(&'a self, query_id: &'a str, text: &'a str) -> BoxFut<'a, ()> {
        Box::pin(Telegram::answer(self, query_id, Some(text)))
    }
}

#[derive(Clone)]
pub struct Options {
    pub log: LogFn,
    pub turn_limit: Duration,
    pub push_retry: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self { log: Arc::new(|_, _| {}), turn_limit: REPLY_TURN_LIMIT, push_retry: PUSH_RETRY }
    }
}

struct Outgoing {
    text: String,
    buttons: Vec<Vec<Button>>,
    tries: usize,
}

pub struct Bot {
    wire: Arc<dyn Wire>,
    brain: Arc<dyn Brain>,
    opts: Options,
    push: AtomicBool,
    /// One ARK turn at a time.
    turns: tokio::sync::Mutex<()>,
    outbox: Mutex<VecDeque<Outgoing>>,
    retrying: AtomicBool,
    known_asks: Mutex<HashSet<String>>,
    stopped: AtomicBool,
}

/// `/word` or `/word@bot`, then a space, punctuation or the end. "/tmp/build.log is huge" is a message for ARK.
fn command_name(text: &str) -> Option<(String, Vec<&str>)> {
    let mut words = text.split_whitespace();
    let head = words.next()?.strip_prefix('/')?;
    let name_end = head.find(|c: char| !(c.is_ascii_alphabetic() || c == '_')).unwrap_or(head.len());
    if name_end == 0 {
        return None;
    }
    let rest = &head[name_end..];
    let after_at = rest.strip_prefix('@').map(|r| r.trim_start_matches(|c: char| c.is_alphanumeric() || c == '_'));
    let tail = after_at.unwrap_or(rest);
    let ok = tail.is_empty() || tail.starts_with(['.', '!', '?', ',', ':', ';']);
    ok.then(|| (head[..name_end].to_lowercase(), words.collect()))
}

fn ask_buttons(id: &str) -> Vec<Vec<Button>> {
    vec![vec![Button { text: "Allow".into(), data: format!("a:{id}:1") }, Button { text: "Decline".into(), data: format!("a:{id}:0") }]]
}

fn ask_text(a: &Ask) -> String {
    format!("ARK asks: {}\n{}", a.summary, a.reason)
}

impl Bot {
    pub fn new(wire: Arc<dyn Wire>, brain: Arc<dyn Brain>, opts: Options) -> Arc<Bot> {
        let known = brain.pending_asks().into_iter().map(|a| a.id).collect();
        Arc::new(Bot { wire, brain, opts, push: AtomicBool::new(true), turns: tokio::sync::Mutex::new(()), outbox: Mutex::default(), retrying: AtomicBool::new(false), known_asks: Mutex::new(known), stopped: AtomicBool::new(false) })
    }

    /// Starts Telegram long polling and hands each input to the bot. Needs a tokio runtime.
    pub fn start(cfg: Config, brain: Arc<dyn Brain>, opts: Options) -> (Arc<Bot>, Arc<Telegram>) {
        let slot: Arc<Mutex<Option<Arc<Bot>>>> = Arc::default();
        let feed = Arc::clone(&slot);
        let telegram = Telegram::start(cfg, move |input| {
            if let Some(bot) = feed.lock().ok().and_then(|s| s.clone()) {
                bot.take(input);
            }
        });
        let bot = Bot::new(Arc::clone(&telegram) as Arc<dyn Wire>, brain, opts);
        if let Ok(mut s) = slot.lock() {
            *s = Some(Arc::clone(&bot));
        }
        (bot, telegram)
    }

    pub fn set_push(&self, on: bool) {
        self.push.store(on, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
    }

    /// A message ARK writes by itself. `pushed`: a routine result, which follows the push setting. Replies always go.
    pub fn send(self: &Arc<Self>, text: &str, pushed: bool) {
        if (pushed && !self.push.load(Ordering::SeqCst)) || text.trim().is_empty() {
            return;
        }
        (self.opts.log)("telegram.push", if pushed { "routine" } else { "reply" });
        let (me, text) = (Arc::clone(self), text.to_string());
        tokio::spawn(async move {
            me.say(text, Vec::new()).await;
        });
    }

    /// One input from the owner. Does not block: the work runs in tasks.
    pub fn take(self: &Arc<Self>, input: Input) {
        let me = Arc::clone(self);
        match input {
            Input::Button { data, query_id } => {
                tokio::spawn(async move { me.press(&data, &query_id).await });
            }
            Input::Text(text) => {
                let text = text.trim().to_string();
                tokio::spawn(async move {
                    if text.is_empty() {
                        me.say("I read text only.".into(), Vec::new()).await;
                    } else if let Some((name, args)) = command_name(&text) {
                        me.command(&name, &args).await;
                    } else {
                        me.talk(text).await;
                    }
                });
            }
        }
    }

    /// Call when ARK's list of questions changed: each new question is sent once, with its buttons.
    pub fn asks_changed(self: &Arc<Self>) {
        let live = self.brain.pending_asks();
        let fresh: Vec<Ask> = {
            let Ok(mut known) = self.known_asks.lock() else { return };
            let ids: HashSet<String> = live.iter().map(|a| a.id.clone()).collect();
            known.retain(|id| ids.contains(id));
            live.into_iter().filter(|a| known.insert(a.id.clone())).collect()
        };
        if fresh.is_empty() || !self.push.load(Ordering::SeqCst) {
            return;
        }
        (self.opts.log)("telegram.push", "needs");
        let me = Arc::clone(self);
        tokio::spawn(async move {
            for a in fresh {
                me.say(ask_text(&a), ask_buttons(&a.id)).await;
            }
        });
    }

    async fn talk(self: &Arc<Self>, text: String) {
        let _turn = self.turns.lock().await;
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(self.opts.turn_limit, self.brain.ask(text)).await;
        let ms = started.elapsed().as_millis().to_string();
        match result {
            Ok(Ok(answer)) => {
                (self.opts.log)("telegram.turn", &format!("ok ms={ms}"));
                self.say(answer, Vec::new()).await;
            }
            Ok(Err(reason)) => {
                (self.opts.log)("telegram.turn", &format!("failed ms={ms}"));
                self.say(format!("ARK could not answer: {reason}"), Vec::new()).await;
            }
            Err(_) => {
                (self.opts.log)("telegram.turn", &format!("timeout ms={ms}"));
                let wait = self.opts.turn_limit.as_secs();
                let how = if wait >= 60 { format!("{} minutes", wait / 60) } else { format!("{} seconds", wait.max(1)) };
                self.say(format!("ARK could not answer: ARK did not answer in {how}, so that message was dropped. Send it again."), Vec::new()).await;
            }
        }
    }

    async fn command(self: &Arc<Self>, name: &str, args: &[&str]) {
        let known = ["needs", "tasks", "report", "steer", "interrupt", "help", "start"].contains(&name);
        (self.opts.log)("telegram.command", if known { name } else { "unknown" });
        let number = |w: Option<&&str>| w.and_then(|w| w.trim_start_matches('#').parse::<u64>().ok()).filter(|n| *n >= 1);
        match name {
            "needs" => self.needs().await,
            "tasks" => self.say("The team is not available.".into(), Vec::new()).await,
            "report" if number(args.first()).is_none() => self.say("Send /report and a task number, for example /report 12.".into(), Vec::new()).await,
            "report" => self.say("The team is not available.".into(), Vec::new()).await,
            "steer" | "interrupt" => self.say("Steering is off.".into(), Vec::new()).await,
            "help" | "start" => self.say(HELP.into(), Vec::new()).await,
            _ => self.say(format!("I do not know that command.\n\n{HELP}"), Vec::new()).await,
        }
    }

    async fn needs(self: &Arc<Self>) {
        let asks = self.brain.pending_asks();
        if asks.is_empty() {
            self.say("Nothing waits for you.".into(), Vec::new()).await;
            return;
        }
        for a in asks.iter().take(NEEDS_SHOWN) {
            self.say(ask_text(a), ask_buttons(&a.id)).await;
        }
        if asks.len() > NEEDS_SHOWN {
            self.say(format!("{} more wait in the ARK window.", asks.len() - NEEDS_SHOWN), Vec::new()).await;
        }
    }

    async fn press(self: &Arc<Self>, data: &str, query_id: &str) {
        let mut parts = data.split(':');
        let (kind, id, yes) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next() == Some("1"));
        (self.opts.log)("telegram.button", kind);
        let said = match kind {
            "a" if !self.brain.pending_asks().iter().any(|a| a.id == id) => "That question has already ended.",
            "a" => {
                self.brain.answer_ask(id, yes);
                if yes { "Allowed." } else { "Declined." }
            }
            "p" | "s" | "d" | "e" | "h" | "r" => "The team is not available.",
            _ => "That button is out of date.",
        };
        self.wire.answer(query_id, said).await;
    }

    /// Sends now. A send that failed waits in a small outbox and is tried again every `push_retry`, in order, up to 6 tries in all.
    async fn say(self: &Arc<Self>, text: String, buttons: Vec<Vec<Button>>) {
        let ok = self.wire.send(&text, &buttons).await;
        if !ok && !self.stopped.load(Ordering::SeqCst) {
            if let Ok(mut out) = self.outbox.lock() {
                if out.len() >= OUTBOX_MAX {
                    out.pop_front();
                }
                out.push_back(Outgoing { text, buttons, tries: 1 });
            }
            self.arm_outbox();
        }
    }

    fn arm_outbox(self: &Arc<Self>) {
        if self.retrying.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(me.opts.push_retry).await;
                if me.stopped.load(Ordering::SeqCst) {
                    break;
                }
                let head = me.outbox.lock().ok().and_then(|o| o.front().map(|i| (i.text.clone(), i.buttons.clone())));
                let Some((text, buttons)) = head else { break };
                let ok = me.wire.send(&text, &buttons).await;
                let Ok(mut out) = me.outbox.lock() else { break };
                if let Some(item) = out.front_mut() {
                    item.tries += 1;
                    if ok || item.tries > PUSH_TRIES {
                        out.pop_front();
                        if !ok {
                            (me.opts.log)("telegram.reply_dropped", "");
                        }
                    }
                }
                if out.is_empty() {
                    break;
                }
            }
            me.retrying.store(false, Ordering::SeqCst);
        });
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[derive(Default)]
    struct FakeWire {
        sent: Mutex<Vec<(String, usize)>>,
        answers: Mutex<Vec<String>>,
        fail_first: AtomicUsize,
    }
    impl Wire for FakeWire {
        fn send<'a>(&'a self, text: &'a str, buttons: &'a [Vec<Button>]) -> BoxFut<'a, bool> {
            Box::pin(async move {
                if self.fail_first.load(Ordering::SeqCst) > 0 {
                    self.fail_first.fetch_sub(1, Ordering::SeqCst);
                    return false;
                }
                self.sent.lock().unwrap().push((text.into(), buttons.len()));
                true
            })
        }
        fn answer<'a>(&'a self, _: &'a str, text: &'a str) -> BoxFut<'a, ()> {
            Box::pin(async move { self.answers.lock().unwrap().push(text.into()) })
        }
    }

    struct FakeBrain {
        reply: Mutex<String>,
        delay: Duration,
        asks: Mutex<Vec<Ask>>,
        answered: Mutex<Vec<(String, bool)>>,
        asked: Mutex<Vec<String>>,
    }
    impl FakeBrain {
        fn new(delay: Duration) -> Arc<Self> {
            Arc::new(Self { reply: Mutex::new("hi back".into()), delay, asks: Mutex::default(), answered: Mutex::default(), asked: Mutex::default() })
        }
    }
    impl Brain for FakeBrain {
        fn ask(&self, text: String) -> BoxFut<'_, Result<String, String>> {
            Box::pin(async move {
                self.asked.lock().unwrap().push(text);
                tokio::time::sleep(self.delay).await;
                Ok(self.reply.lock().unwrap().clone())
            })
        }
        fn pending_asks(&self) -> Vec<Ask> {
            self.asks.lock().unwrap().clone()
        }
        fn answer_ask(&self, id: &str, approved: bool) {
            self.answered.lock().unwrap().push((id.into(), approved));
            self.asks.lock().unwrap().retain(|a| a.id != id);
        }
    }

    async fn until(what: &str, f: impl Fn() -> bool) {
        for _ in 0..300 {
            if f() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for {what}");
    }

    fn setup(delay: Duration) -> (Arc<Bot>, Arc<FakeWire>, Arc<FakeBrain>) {
        let (wire, brain) = (Arc::new(FakeWire::default()), FakeBrain::new(delay));
        let opts = Options { push_retry: Duration::from_millis(20), turn_limit: Duration::from_millis(200), ..Options::default() };
        (Bot::new(wire.clone(), brain.clone(), opts), wire, brain)
    }

    fn sent(wire: &FakeWire) -> Vec<String> {
        wire.sent.lock().unwrap().iter().map(|(t, _)| t.clone()).collect()
    }

    #[test]
    fn a_command_is_a_slash_word_not_a_path() {
        assert_eq!(command_name("/help"), Some(("help".into(), vec![])));
        assert_eq!(command_name("/Report@ark_bot 12"), Some(("report".into(), vec!["12"])));
        assert_eq!(command_name("/needs!"), Some(("needs".into(), vec![])));
        assert_eq!(command_name("/tmp/build.log is huge"), None);
        assert_eq!(command_name("hello /help"), None);
        assert_eq!(command_name("/"), None);
    }

    #[tokio::test]
    async fn commands_answer_and_a_message_goes_to_ark() {
        let (bot, wire, brain) = setup(Duration::ZERO);
        bot.take(Input::Text("/help".into()));
        bot.take(Input::Text("/needs".into()));
        bot.take(Input::Text("/steer 3 x".into()));
        bot.take(Input::Text("/nope".into()));
        bot.take(Input::Text("/tmp/x is big".into()));
        bot.take(Input::Text("   ".into()));
        until("six replies", || sent(&wire).len() == 6).await;
        let all = sent(&wire).join("|");
        assert!(all.contains("I am ARK") && all.contains("Nothing waits for you.") && all.contains("Steering is off.") && all.contains("I do not know that command.") && all.contains("hi back") && all.contains("I read text only."), "{all}");
        assert_eq!(*brain.asked.lock().unwrap(), vec!["/tmp/x is big".to_string()]);
    }

    #[tokio::test]
    async fn one_turn_at_a_time_and_a_slow_one_is_given_up() {
        let (bot, wire, brain) = setup(Duration::from_millis(60));
        bot.take(Input::Text("one".into()));
        bot.take(Input::Text("two".into()));
        until("two answers", || sent(&wire).len() == 2).await;
        assert_eq!(brain.asked.lock().unwrap().len(), 2);
        let (bot, wire, _) = setup(Duration::from_secs(5));
        bot.take(Input::Text("slow".into()));
        until("timeout message", || sent(&wire).iter().any(|t| t.contains("did not answer in"))).await;
    }

    #[tokio::test]
    async fn a_question_gets_buttons_once_and_a_press_answers_it() {
        let (bot, wire, brain) = setup(Duration::ZERO);
        brain.asks.lock().unwrap().push(Ask { id: "rs-1".into(), summary: "Write 4 bytes to a.txt".into(), reason: "why".into() });
        bot.asks_changed();
        bot.asks_changed();
        until("the push", || !sent(&wire).is_empty()).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(wire.sent.lock().unwrap().clone(), vec![("ARK asks: Write 4 bytes to a.txt\nwhy".to_string(), 1)], "sent once, with one row of buttons");
        bot.take(Input::Button { data: "a:rs-1:1".into(), query_id: "q".into() });
        bot.take(Input::Button { data: "a:rs-1:1".into(), query_id: "q".into() });
        bot.take(Input::Button { data: "zz:1".into(), query_id: "q".into() });
        until("three toasts", || wire.answers.lock().unwrap().len() == 3).await;
        let mut toasts = wire.answers.lock().unwrap().clone();
        toasts.sort();
        assert_eq!(toasts, ["Allowed.", "That button is out of date.", "That question has already ended."]);
        assert_eq!(*brain.answered.lock().unwrap(), vec![("rs-1".to_string(), true)]);
    }

    #[tokio::test]
    async fn a_failed_send_waits_in_the_outbox_and_the_push_setting_holds_routines_back() {
        let (bot, wire, _) = setup(Duration::ZERO);
        wire.fail_first.store(2, Ordering::SeqCst);
        bot.take(Input::Text("/help".into()));
        until("the retry", || sent(&wire).len() == 1).await;
        bot.set_push(false);
        bot.send("routine result", true);
        bot.send("an agent reported", false);
        until("the reply", || sent(&wire).iter().any(|t| t == "an agent reported")).await;
        assert!(!sent(&wire).contains(&"routine result".to_string()));
    }
}
