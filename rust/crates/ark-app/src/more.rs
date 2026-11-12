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
}

impl Default for More {
    fn default() -> Self {
        Self { flow_filter: 0, confirm: None, hub_query: TextEdit::new("") }
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
