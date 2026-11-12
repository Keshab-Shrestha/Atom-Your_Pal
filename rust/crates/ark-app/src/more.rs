//! State of the later screens (automations, plugins, skills hub, backup, replies, plans, terminal) and the
//! helpers that send their commands. Each screen reads `ark_ui::extras` for what the runtime says.

use ark_protocol::Command;
use rune::TextEdit;

use crate::app::App;

pub struct More {
    /// Automations filter: 0 all, 1 on a timer, 2 when something happens, 3 by hand.
    pub flow_filter: usize,
    /// A delete (workflow id, routine id) that waits for the second press.
    pub confirm: Option<String>,
    /// The skills hub search field.
    pub hub_query: TextEdit,
    /// Reply drafts: what was written, what to say, background, the notes lookup and the checked notes (ids).
    pub reply: [TextEdit; 4],
    pub reply_checked: Vec<String>,
    /// Plan notes: (plan id, portion, mark 0..3).
    pub plan_notes: Vec<(u64, u64, usize)>,
    /// The workspace screen: the address bar, the command line, and the terminal's last redraw count.
    pub address: TextEdit,
    pub command: TextEdit,
    pub terminal: crate::terminal::Terminal,
    pub terminal_seen: u64,
    pub terminal_note: Option<String>,
}

/// The marks a plan note can have (PlanNotes.swift).
pub const PLAN_MARKS: [&str; 3] = ["Looks good", "Clarify", "Needs tests"];

/// A request or session id shaped like a UUID (the protocol asks for one). Not secret.
pub fn uuid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let n = u128::from(COUNT.fetch_add(1, Ordering::Relaxed));
    let h = format!("{:032x}", nanos.rotate_left(17) ^ (n << 64 | n));
    format!("{}-{}-4{}-a{}-{}", &h[0..8], &h[8..12], &h[13..16], &h[17..20], &h[20..32])
}

/// The notes as the message the Swift app puts in the composer: numbered, one line each, by portion.
pub fn plan_message(plan: &ark_ui::extras::WorkPlan, notes: &[(u64, u64, usize)]) -> Option<String> {
    let mut mine: Vec<(u64, usize)> = notes.iter().filter(|n| n.0 == plan.id).map(|n| (n.1, n.2)).collect();
    if mine.is_empty() {
        return None;
    }
    mine.sort_by_key(|n| n.0);
    let cut = |t: &str, max: usize| {
        let one = t.split_whitespace().collect::<Vec<_>>().join(" ").replace('"', "'");
        if one.chars().count() <= max { one } else { format!("{}…", one.chars().take(max - 1).collect::<String>()) }
    };
    let mut out = format!("Notes on the plan \"{}\":", cut(&plan.goal, 80));
    for (i, (portion, mark)) in mine.iter().enumerate() {
        let task = plan.portions.iter().find(|p| p.n == *portion).map(|p| format!(" — \"{}\"", cut(&p.task, 160))).unwrap_or_default();
        out.push_str(&format!("\n{}. [{}] P{portion}{task}", i + 1, PLAN_MARKS[*mark % 3]));
    }
    Some(out)
}

impl Default for More {
    fn default() -> Self {
        Self { flow_filter: 0, confirm: None, hub_query: TextEdit::new(""), reply: std::array::from_fn(|_| TextEdit::new("")), reply_checked: Vec::new(), plan_notes: Vec::new(), address: TextEdit::new(""), command: TextEdit::new(""), terminal: Default::default(), terminal_seen: 0, terminal_note: None }
    }
}

impl More {
    pub fn field(text: &str) -> TextEdit {
        TextEdit::new(text)
    }
}

impl App {
    /// Sends a command the typed protocol does not model, with its `type` set.
    pub fn send_other(&self, kind: &str, mut fields: serde_json::Value) {
        fields["type"] = kind.into();
        self.send(&Command::Other { kind: kind.into(), fields: fields.as_object().cloned().unwrap_or_default() });
    }

    pub fn search_hub(&self) {
        let query = self.more.hub_query.text.trim().to_owned();
        if !query.is_empty() {
            self.send(&Command::SkillHubSearch { query });
        }
    }

    /// Turns a workflow on or off: the same workflow is saved with `enabled` changed.
    pub fn toggle_workflow(&self, id: &str) {
        let Some(flow) = self.model.extras.workflows.as_ref().and_then(|l| l.iter().find(|w| w.id == id)) else { return };
        let mut raw = flow.raw.clone();
        raw.insert("enabled".into(), (!flow.enabled).into());
        self.send(&Command::WorkflowSave { workflow: raw });
        self.send(&Command::WorkflowsList);
    }

    /// Delete asks twice: the first press arms it.
    pub fn confirm_or(&mut self, key: &str, run: impl FnOnce(&mut App)) {
        if self.more.confirm.as_deref() == Some(key) {
            self.more.confirm = None;
            run(self);
        } else {
            self.more.confirm = Some(key.to_owned());
        }
    }
}

impl App {
    /// One `local.backup` command. The runtime wants a request id, the session id, and (to change anything) the reviewed revision.
    pub fn backup(&self, action: &str, extra: serde_json::Value) {
        let mut fields = serde_json::json!({ "request": uuid(), "session": BACKUP_SESSION.with(|s| s.clone()), "action": action });
        if !matches!(action, "get" | "cancel" | "close") {
            fields["revision"] = self.model.extras.backup.as_ref().map(|b| b.revision.clone()).unwrap_or_default().into();
        }
        if let (Some(f), Some(e)) = (fields.as_object_mut(), extra.as_object()) {
            f.extend(e.clone());
        }
        self.send_other("local.backup", fields);
    }

    /// Asks for the profile (empty query) or the notes that match the query. No model call.
    pub fn reply_lookup(&self, query: &str) {
        self.send_other("reply.context", serde_json::json!({ "id": uuid(), "query": query, "chat": self.model.current.clone().unwrap_or_default() }));
    }

    /// Asks for one draft from what the fields hold. Needs the profile from the lookup.
    pub fn reply_draft(&mut self) {
        let Some(profile) = self.model.extras.drafts.profile.clone() else {
            self.reply_lookup("");
            return;
        };
        let [conversation, intent, background, _] = &self.more.reply;
        let context: Vec<_> = self.model.extras.drafts.items.iter().filter(|i| self.more.reply_checked.contains(&i.0)).map(|i| serde_json::json!({ "id": i.0, "revision": i.2 })).collect();
        let input = serde_json::json!({ "profile": profile, "conversation": conversation.text, "intent": intent.text, "background": background.text, "examples": "", "context": context });
        self.send_other("reply.draft", serde_json::json!({ "id": uuid(), "input": input }));
    }

    /// Puts the notes of a plan in the composer after any draft and opens the chat. It never sends.
    pub fn send_plan_notes(&mut self, plan_id: u64) {
        let Some(plan) = self.model.extras.plans.iter().find(|p| p.id == plan_id) else { return };
        let Some(message) = plan_message(plan, &self.more.plan_notes) else { return };
        let sep = if self.draft.text.is_empty() || self.draft.text.ends_with("\n\n") { "" } else if self.draft.text.ends_with('\n') { "\n" } else { "\n\n" };
        self.draft = TextEdit::new(format!("{}{sep}{message}\n", self.draft.text));
        self.draft.focused = true;
        self.more.plan_notes.retain(|n| n.0 != plan_id);
        self.screen = crate::app::Screen::Chat;
    }

    /// Cycles a portion's mark: none, Looks good, Clarify, Needs tests.
    pub fn mark_portion(&mut self, plan: u64, portion: u64, mark: usize) {
        let notes = &mut self.more.plan_notes;
        match notes.iter().position(|n| n.0 == plan && n.1 == portion) {
            Some(i) if notes[i].2 == mark => {
                notes.remove(i);
            }
            Some(i) => notes[i].2 = mark,
            None => notes.push((plan, portion, mark)),
        }
    }
}

impl App {
    /// Opens the address in the default browser. Only http and https. (Rune has no web view; Swift used WKWebView.)
    pub fn open_address(&mut self) {
        let raw = self.more.address.text.trim().to_owned();
        let url = if raw.contains("://") { raw } else { format!("https://{raw}") };
        self.more.terminal_note = Some(if raw_is_web(&url) { crate::about::open_url(&url); format!("Opened {url} in your browser.") } else { "Only http and https addresses open.".into() });
    }

    /// Runs the command line in the project's folder. The folder comes from the runtime's `workspace` answer.
    pub fn run_command_line(&mut self) {
        let command = self.more.command.text.trim().to_owned();
        let Some(root) = self.model.workspace.as_ref().and_then(|w| w.root.clone()) else {
            self.more.terminal_note = Some("Choose a project first.".into());
            return;
        };
        if command.is_empty() {
            return;
        }
        self.more.terminal_note = self.more.terminal.run(&root, &command, self.wake.clone()).err();
        self.more.command = TextEdit::new("");
        self.more.command.focused = true;
    }
}

fn raw_is_web(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

thread_local! {
    /// One session id for the window's life: the runtime keeps the temporary backup turns under it.
    static BACKUP_SESSION: String = uuid();
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_ui::extras::{Portion, WorkPlan};

    #[test]
    fn only_web_addresses_open() {
        assert!(raw_is_web("https://example.com") && !raw_is_web("file:///etc/passwd") && !raw_is_web("javascript:alert(1)"));
    }

    #[test]
    fn ids_look_like_uuids_and_differ() {
        let (a, b) = (uuid(), uuid());
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(a.matches('-').count(), 4);
    }

    #[test]
    fn plan_notes_become_numbered_lines_by_portion() {
        let plan = WorkPlan { id: 3, goal: "Ship \"it\"".into(), portions: vec![Portion { n: 1, task: "Port".into(), ..Default::default() }, Portion { n: 2, task: "Test".into(), ..Default::default() }], ..Default::default() };
        let text = plan_message(&plan, &[(3, 2, 2), (3, 1, 0), (9, 1, 1)]).unwrap_or_default();
        assert_eq!(text, "Notes on the plan \"Ship 'it'\":\n1. [Looks good] P1 — \"Port\"\n2. [Needs tests] P2 — \"Test\"");
        assert!(plan_message(&plan, &[]).is_none());
    }
}
