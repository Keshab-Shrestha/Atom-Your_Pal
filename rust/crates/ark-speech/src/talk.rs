//! The `talk.*` commands as a state machine. Each call gives the events to send to the app, in order.
//! The app shows `state` (listening, transcribing, thinking, speaking) and `mic.level` as the "mic is live" feedback.

use ark_protocol::Event;
use ark_protocol::events::{ErrorStage, LoopState, NoticeKind};

use crate::engine::SpeechEngine;

pub struct Talk<E: SpeechEngine> {
    engine: E,
    state: LoopState,
}

impl<E: SpeechEngine> Talk<E> {
    pub fn new(engine: E) -> Talk<E> {
        Talk { engine, state: LoopState::Idle }
    }

    pub fn state(&self) -> LoopState {
        self.state
    }

    pub fn engine(&mut self) -> &mut E {
        &mut self.engine
    }

    fn to(&mut self, state: LoopState) -> Event {
        self.state = state;
        Event::State { state }
    }

    /// `talk.start`: a new request ends the speech and opens the microphone. While listening it is a repeat: nothing changes.
    pub fn start(&mut self) -> Vec<Event> {
        if self.state == LoopState::Listening {
            return Vec::new();
        }
        self.engine.stop_speaking();
        match self.engine.start_listening() {
            Ok(()) => vec![self.to(LoopState::Listening), Event::MicReady],
            Err(e) => vec![Event::error(ErrorStage::Microphone, e.0), self.to(LoopState::Idle)],
        }
    }

    /// `talk.send`: closes the microphone. The `transcript` event follows; the chat then answers it.
    pub fn send(&mut self) -> Vec<Event> {
        if self.state != LoopState::Listening {
            return Vec::new();
        }
        let mut events = self.level_events();
        events.push(self.to(LoopState::Transcribing));
        match self.engine.finish_listening() {
            Ok(text) if text.is_empty() => events.extend([Event::Notice { kind: NoticeKind::NoSpeech, message: "No speech heard.".into() }, self.to(LoopState::Idle)]),
            Ok(text) => events.extend([Event::Transcript { text }, self.to(LoopState::Thinking)]),
            Err(e) => events.extend([Event::error(ErrorStage::Transcription, e.0), self.to(LoopState::Idle)]),
        }
        events
    }

    /// `talk.cancel` (Esc): drops the audio and stops the speech.
    pub fn cancel(&mut self) -> Vec<Event> {
        self.engine.cancel_listening();
        self.engine.stop_speaking();
        if self.state == LoopState::Idle { Vec::new() } else { vec![self.to(LoopState::Idle)] }
    }

    /// The reply of the chat: speaks it.
    pub fn reply(&mut self, text: &str) -> Vec<Event> {
        match self.engine.speak(text) {
            Ok(()) => vec![self.to(LoopState::Speaking)],
            Err(e) => vec![Event::error(ErrorStage::Speech, e.0), self.to(LoopState::Idle)],
        }
    }

    /// Call it every few hundred milliseconds: gives the mic levels while listening, and `idle` when the speech ended.
    pub fn tick(&mut self) -> Vec<Event> {
        match self.state {
            LoopState::Listening => self.level_events(),
            LoopState::Speaking if !self.engine.is_speaking() => vec![self.to(LoopState::Idle)],
            _ => Vec::new(),
        }
    }

    fn level_events(&mut self) -> Vec<Event> {
        self.engine.levels().into_iter().filter_map(serde_json::Number::from_f64).map(|peak| Event::MicLevel { peak }).collect()
    }

    /// Runs one `talk.*` command line. `None` for another command.
    pub fn handle(&mut self, kind: &str) -> Option<Vec<Event>> {
        Some(match kind {
            "talk.start" => self.start(),
            "talk.send" => self.send(),
            "talk.cancel" => self.cancel(),
            _ => return None,
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::engine::FakeEngine;

    fn lines(events: &[Event]) -> Vec<String> {
        events.iter().map(|e| e.to_line().trim().to_string()).collect()
    }

    #[test]
    fn a_turn_goes_listening_transcribing_thinking_speaking_idle() {
        let mut t = Talk::new(FakeEngine { transcript: "open notes".into(), ..FakeEngine::default() });
        assert_eq!(lines(&t.start()), [r#"{"state":"listening","type":"state"}"#, r#"{"type":"mic.ready"}"#]);
        assert!(t.start().is_empty(), "a repeat while listening changes nothing");
        t.engine().peaks = vec![0.25];
        assert_eq!(lines(&t.tick()), [r#"{"peak":0.25,"type":"mic.level"}"#]);
        let sent = lines(&t.send());
        assert_eq!(sent, [r#"{"state":"transcribing","type":"state"}"#, r#"{"text":"open notes","type":"transcript"}"#, r#"{"state":"thinking","type":"state"}"#]);
        assert_eq!(lines(&t.reply("Done.")), [r#"{"state":"speaking","type":"state"}"#]);
        assert!(t.tick().is_empty());
        t.engine().speaking = false;
        assert_eq!(lines(&t.tick()), [r#"{"state":"idle","type":"state"}"#]);
        assert_eq!(t.engine().calls, ["stop", "start", "finish", "speak:Done."]);
    }

    #[test]
    fn empty_speech_and_a_failed_microphone_end_in_idle_with_a_message() {
        let mut t = Talk::new(FakeEngine::default());
        t.start();
        let sent = lines(&t.send());
        assert!(sent[1].contains("no_speech") && sent[2].contains("idle"), "{sent:?}");
        let mut t = Talk::new(FakeEngine { fail_start: true, ..FakeEngine::default() });
        let started = lines(&t.start());
        assert!(started[0].contains("\"stage\":\"microphone\"") && started[1].contains("idle"), "{started:?}");
    }

    #[test]
    fn cancel_drops_the_audio_and_the_speech() {
        let mut t = Talk::new(FakeEngine::default());
        t.start();
        assert_eq!(lines(&t.cancel()), [r#"{"state":"idle","type":"state"}"#]);
        assert!(t.cancel().is_empty());
        assert_eq!(t.engine().calls, ["stop", "start", "cancel", "stop", "cancel", "stop"]);
        assert!(t.handle("chat.send").is_none());
    }
}
