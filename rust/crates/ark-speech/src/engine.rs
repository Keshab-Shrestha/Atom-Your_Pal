//! The speech boundary, and a fake for tests.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeechError(pub String);

impl fmt::Display for SpeechError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SpeechError {}

/// Speech out and speech in. No call blocks except `finish_listening`.
pub trait SpeechEngine: Send {
    /// Starts to speak `text`. Returns at once.
    fn speak(&mut self, text: &str) -> Result<(), SpeechError>;
    /// True while the speech started by `speak` plays.
    fn is_speaking(&mut self) -> bool;
    fn stop_speaking(&mut self);
    /// Opens the microphone.
    fn start_listening(&mut self) -> Result<(), SpeechError>;
    /// Closes the microphone and waits for the transcript. An empty text means no speech.
    fn finish_listening(&mut self) -> Result<String, SpeechError>;
    /// Closes the microphone and drops the audio.
    fn cancel_listening(&mut self);
    /// Microphone peaks (0 to 1) since the last call: the app draws them as the "mic is live" feedback.
    fn levels(&mut self) -> Vec<f64> {
        Vec::new()
    }
}

impl SpeechEngine for Box<dyn SpeechEngine> {
    fn speak(&mut self, text: &str) -> Result<(), SpeechError> {
        (**self).speak(text)
    }
    fn is_speaking(&mut self) -> bool {
        (**self).is_speaking()
    }
    fn stop_speaking(&mut self) {
        (**self).stop_speaking();
    }
    fn start_listening(&mut self) -> Result<(), SpeechError> {
        (**self).start_listening()
    }
    fn finish_listening(&mut self) -> Result<String, SpeechError> {
        (**self).finish_listening()
    }
    fn cancel_listening(&mut self) {
        (**self).cancel_listening();
    }
    fn levels(&mut self) -> Vec<f64> {
        (**self).levels()
    }
}

/// A recorded call, in order: `speak:<text>`, `stop`, `start`, `finish`, `cancel`.
#[derive(Debug, Default)]
pub struct FakeEngine {
    pub calls: Vec<String>,
    pub transcript: String,
    pub fail_start: bool,
    pub speaking: bool,
    pub peaks: Vec<f64>,
}

impl SpeechEngine for FakeEngine {
    fn speak(&mut self, text: &str) -> Result<(), SpeechError> {
        self.calls.push(format!("speak:{text}"));
        self.speaking = true;
        Ok(())
    }
    fn is_speaking(&mut self) -> bool {
        self.speaking
    }
    fn stop_speaking(&mut self) {
        self.calls.push("stop".into());
        self.speaking = false;
    }
    fn start_listening(&mut self) -> Result<(), SpeechError> {
        self.calls.push("start".into());
        if self.fail_start { Err(SpeechError("no microphone".into())) } else { Ok(()) }
    }
    fn finish_listening(&mut self) -> Result<String, SpeechError> {
        self.calls.push("finish".into());
        Ok(self.transcript.clone())
    }
    fn cancel_listening(&mut self) {
        self.calls.push("cancel".into());
    }
    fn levels(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.peaks)
    }
}
