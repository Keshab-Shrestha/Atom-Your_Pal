//! `talk.*` answered by Rust (ADR-278, section 5(b)). Opt-in: `ARK_SPEECH_NATIVE=1`, with the Parakeet helper in
//! `ARK_DICTATION_HELPER` (a program that speaks the line contract of `ark_speech::HelperListener`).
//! `answer` gives the events of one command as lines. `poll` is called with the change feed: it gives the mic levels and
//! the end of the speech. The chat reply is spoken with `speak_reply`.

use std::sync::Mutex;

use ark_protocol::Event;
use ark_speech::{NativeEngine, SayVoice, SpeechEngine, Talk};

pub struct TalkNative {
    talk: Mutex<Talk<Box<dyn SpeechEngine>>>,
}

impl std::fmt::Debug for TalkNative {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TalkNative")
    }
}

fn lines(events: &[Event]) -> String {
    events.iter().map(Event::to_line).collect()
}

impl TalkNative {
    pub fn new(engine: Box<dyn SpeechEngine>) -> TalkNative {
        TalkNative { talk: Mutex::new(Talk::new(engine)) }
    }

    /// `Some` when the environment turns it on: `ARK_SPEECH_NATIVE=1`.
    pub fn from_environment(lookup: impl Fn(&str) -> Option<String>) -> Option<TalkNative> {
        (lookup("ARK_SPEECH_NATIVE").as_deref() == Some("1")).then(|| {
            let helper = lookup("ARK_DICTATION_HELPER").map(|p| (p.into(), Vec::new()));
            TalkNative::new(Box::new(NativeEngine::new(SayVoice { voice: lookup("ARK_SPEECH_VOICE"), words_per_minute: None }, helper)))
        })
    }

    /// The lines for a `talk.*` command line; `None` for any other line.
    pub fn answer(&self, line: &str) -> Option<String> {
        if !line.contains("\"talk.") {
            return None;
        }
        let kind = serde_json::from_str::<serde_json::Value>(line).ok()?["type"].as_str()?.to_string();
        let events = self.talk.lock().ok()?.handle(&kind)?;
        Some(lines(&events))
    }

    pub fn poll(&self) -> Option<String> {
        let events = self.talk.lock().ok()?.tick();
        (!events.is_empty()).then(|| lines(&events))
    }

    pub fn speak_reply(&self, text: &str) -> Option<String> {
        Some(lines(&self.talk.lock().ok()?.reply(text)))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use ark_speech::FakeEngine;

    #[test]
    fn it_answers_talk_commands_with_event_lines_and_ignores_the_rest() {
        let t = TalkNative::new(Box::new(FakeEngine { transcript: "hi".into(), ..FakeEngine::default() }));
        assert!(t.answer(r#"{"type":"chat.send"}"#).is_none());
        assert_eq!(t.answer(r#"{"type":"talk.start"}"#).unwrap(), "{\"state\":\"listening\",\"type\":\"state\"}\n{\"type\":\"mic.ready\"}\n");
        assert!(t.answer(r#"{"type":"talk.send"}"#).unwrap().contains("\"text\":\"hi\""));
        assert!(t.poll().is_none());
        assert!(TalkNative::from_environment(|_| None).is_none());
    }
}
