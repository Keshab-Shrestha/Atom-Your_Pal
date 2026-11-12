//! Find in chat: a case-insensitive search over the loaded messages (ChatFindBar.swift).

use crate::model::{Message, Role};

/// Matches shown at most; `more` tells there are others.
pub const MAX_MATCHES: usize = 200;
const CONTEXT: usize = 40;

#[derive(Debug, Clone, PartialEq)]
pub struct Match {
    /// Index of the message.
    pub message: usize,
    pub user: bool,
    pub before: String,
    pub found: String,
    pub after: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Results {
    pub matches: Vec<Match>,
    pub more: bool,
}

impl Results {
    /// The selected match; the index wraps into range.
    pub fn selected(&self, index: usize) -> Option<&Match> {
        (!self.matches.is_empty()).then(|| &self.matches[index % self.matches.len()])
    }
}

fn clip_start(s: &str) -> String {
    let n = s.chars().count();
    if n <= CONTEXT { s.to_owned() } else { format!("…{}", s.chars().skip(n - CONTEXT).collect::<String>()) }
}

fn clip_end(s: &str) -> String {
    if s.chars().count() <= CONTEXT { s.to_owned() } else { format!("{}…", s.chars().take(CONTEXT).collect::<String>()) }
}

/// Every place the query occurs in a message, first to last. An empty query finds nothing.
pub fn find(messages: &[Message], query: &str) -> Results {
    let needle: Vec<char> = query.trim().to_lowercase().chars().collect();
    let mut out = Results::default();
    if needle.is_empty() {
        return out;
    }
    for (message, m) in messages.iter().enumerate() {
        let chars: Vec<char> = m.text.chars().collect();
        let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
        let mut at = 0;
        while at + needle.len() <= lower.len() {
            if lower[at..at + needle.len()] == needle[..] {
                if out.matches.len() == MAX_MATCHES {
                    out.more = true;
                    return out;
                }
                let end = at + needle.len();
                out.matches.push(Match {
                    message,
                    user: m.role == Role::User,
                    before: clip_start(&chars[..at].iter().collect::<String>()),
                    found: chars[at..end].iter().collect(),
                    after: clip_end(&chars[end..].iter().collect::<String>()),
                });
                at = end;
            } else {
                at += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: Role, text: &str) -> Message {
        Message { role, text: text.into() }
    }

    #[test]
    fn finds_every_occurrence_ignoring_case() {
        let r = find(&[msg(Role::User, "Rune is fast"), msg(Role::Assistant, "rune and RUNE")], " rune ");
        assert_eq!(r.matches.len(), 3);
        assert!(r.matches[0].user && !r.matches[1].user);
        assert_eq!(r.matches[2].found, "RUNE");
        assert_eq!(r.matches[1].after, " and RUNE");
    }

    #[test]
    fn empty_query_finds_nothing_and_selection_wraps() {
        assert!(find(&[msg(Role::User, "x")], "  ").matches.is_empty());
        let r = find(&[msg(Role::User, "a a")], "a");
        assert_eq!(r.selected(3), Some(&r.matches[1]));
    }
}
