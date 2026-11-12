//! The command palette: a filtered list of screens, actions and chats (CommandPaletteView.swift).

use crate::app::{App, Screen};
use ark_protocol::Command;
use ark_ui::Model;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    NewChat,
    Go(Screen),
    Find,
    Details,
    OpenChat(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub title: String,
    pub action: Action,
}

/// Every entry, before the filter: actions first, then screens, then chats (newest first as the runtime sends them).
pub fn entries(model: &Model) -> Vec<Entry> {
    let mut out = vec![Entry { title: "New chat".into(), action: Action::NewChat }, Entry { title: "Find in chat".into(), action: Action::Find }, Entry { title: "Chat details".into(), action: Action::Details }];
    for (title, screen) in [("Agents", Screen::Agents), ("Tasks", Screen::Tasks), ("Memory", Screen::Memory), ("Projects", Screen::Projects), ("Branches", Screen::Branches), ("Search", Screen::Search), ("Dashboard", Screen::Dashboard), ("Automations", Screen::Workflows), ("Plugins", Screen::Plugins), ("Skills hub", Screen::Skills), ("Plans", Screen::Plans), ("Workspace", Screen::Terminal), ("Reply drafts", Screen::Replies), ("Local backup", Screen::Backup), ("Settings", Screen::Settings)] {
        out.push(Entry { title: format!("Go to {title}"), action: Action::Go(screen) });
    }
    for chat in &model.chats {
        out.push(Entry { title: format!("Open chat: {}", chat.title), action: Action::OpenChat(chat.id.clone()) });
    }
    out
}

/// The entries whose title holds every word of the query, in any case. An empty query keeps all.
pub fn filter(all: Vec<Entry>, query: &str) -> Vec<Entry> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    all.into_iter().filter(|e| {
        let title = e.title.to_lowercase();
        words.iter().all(|w| title.contains(w))
    }).collect()
}

impl App {
    pub fn toggle_palette(&mut self) {
        self.palette = match self.palette {
            Some(_) => None,
            None => {
                let mut q = rune::TextEdit::new("");
                q.focused = true;
                Some(q)
            }
        };
    }

    /// Runs an entry and closes the palette.
    pub fn run_palette(&mut self, action: Action) {
        self.palette = None;
        match action {
            Action::NewChat => self.new_chat(),
            Action::Go(screen) => self.goto(screen),
            Action::Find => {
                if self.find.is_none() {
                    self.toggle_find();
                }
            }
            Action::Details => {
                self.screen = Screen::Chat;
                self.details = !self.details;
            }
            Action::OpenChat(id) => {
                self.screen = Screen::Chat;
                self.send(&Command::ChatOpen { id });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_filter_needs_every_word() {
        let all = entries(&Model::default());
        assert!(filter(all.clone(), "").len() >= 7);
        let hits = filter(all, "go SET");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].action, Action::Go(Screen::Settings));
    }
}
