//! The macOS engine: `say` for speech out, the Parakeet helper process for speech in.
//!
//! Helper contract (line-delimited JSON on stdio, like the other helpers in the migration plan):
//! ARK writes `{"cmd":"start"}`, `{"cmd":"stop"}` or `{"cmd":"cancel"}`. The helper writes
//! `{"type":"level","peak":0.2}` while it records, then `{"type":"transcript","text":"..."}` after `stop`,
//! or `{"type":"error","message":"..."}`. The helper is Swift (FluidAudio, Neural Engine); Rust has no Parakeet binding.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::Duration;

use serde_json::Value;

use crate::engine::{SpeechEngine, SpeechError};

/// How long `finish_listening` waits for the transcript.
const TRANSCRIPT_WAIT: Duration = Duration::from_secs(60);

/// The macOS voice and speed of `say`. `None` is the system default.
#[derive(Debug, Clone, Default)]
pub struct SayVoice {
    pub voice: Option<String>,
    pub words_per_minute: Option<u32>,
}

/// A running helper process.
pub struct HelperListener {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
}

impl HelperListener {
    pub fn spawn(program: &PathBuf, args: &[String]) -> Result<HelperListener, SpeechError> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| SpeechError(format!("The dictation helper did not start: {e}")))?;
        let stdin = child.stdin.take().ok_or_else(|| SpeechError("The dictation helper has no input.".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| SpeechError("The dictation helper has no output.".into()))?;
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line)
                    && tx.send(value).is_err()
                {
                    break;
                }
            }
        });
        Ok(HelperListener { child, stdin, lines })
    }

    fn send(&mut self, cmd: &str) -> Result<(), SpeechError> {
        writeln!(self.stdin, "{{\"cmd\":\"{cmd}\"}}").and_then(|()| self.stdin.flush()).map_err(|e| SpeechError(format!("The dictation helper stopped: {e}")))
    }

    fn start(&mut self) -> Result<(), SpeechError> {
        while self.lines.try_recv().is_ok() {} // old lines of an earlier turn
        self.send("start")
    }

    fn finish(&mut self) -> Result<String, SpeechError> {
        self.send("stop")?;
        loop {
            match self.lines.recv_timeout(TRANSCRIPT_WAIT) {
                Ok(v) if v["type"] == "transcript" => return Ok(v["text"].as_str().unwrap_or("").trim().to_string()),
                Ok(v) if v["type"] == "error" => return Err(SpeechError(v["message"].as_str().unwrap_or("Dictation failed.").to_string())),
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => return Err(SpeechError("The dictation helper took too long.".into())),
                Err(RecvTimeoutError::Disconnected) => return Err(SpeechError("The dictation helper stopped.".into())),
            }
        }
    }

    fn peaks(&mut self) -> Vec<f64> {
        let mut peaks = Vec::new();
        while let Ok(v) = self.lines.try_recv() {
            if let (true, Some(p)) = (v["type"] == "level", v["peak"].as_f64()) {
                peaks.push(p.clamp(0.0, 1.0));
            }
        }
        peaks
    }
}

impl Drop for HelperListener {
    fn drop(&mut self) {
        // Ignore failures: the process may be gone already.
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

/// `say` out, helper in. The helper starts on the first `start_listening`.
pub struct NativeEngine {
    say: SayVoice,
    helper: Option<(PathBuf, Vec<String>)>,
    listener: Option<HelperListener>,
    speaking: Option<Child>,
}

impl NativeEngine {
    pub fn new(say: SayVoice, helper: Option<(PathBuf, Vec<String>)>) -> NativeEngine {
        NativeEngine { say, helper, listener: None, speaking: None }
    }

    /// The arguments of `say` for `text`. The text goes after `--`, so a text that starts with `-` is not an option.
    pub fn say_args(&self, text: &str) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(voice) = &self.say.voice {
            args.extend(["-v".to_string(), voice.clone()]);
        }
        if let Some(rate) = self.say.words_per_minute {
            args.extend(["-r".to_string(), rate.to_string()]);
        }
        args.extend(["--".to_string(), text.to_string()]);
        args
    }

    fn listener(&mut self) -> Result<&mut HelperListener, SpeechError> {
        if self.listener.is_none() {
            let (program, args) = self.helper.as_ref().ok_or_else(|| SpeechError("No dictation helper is set up.".into()))?;
            self.listener = Some(HelperListener::spawn(program, args)?);
        }
        self.listener.as_mut().ok_or_else(|| SpeechError("No dictation helper.".into()))
    }
}

impl SpeechEngine for NativeEngine {
    fn speak(&mut self, text: &str) -> Result<(), SpeechError> {
        self.stop_speaking();
        let child = Command::new("say").args(self.say_args(text)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| SpeechError(format!("`say` did not start: {e}")))?;
        self.speaking = Some(child);
        Ok(())
    }
    fn is_speaking(&mut self) -> bool {
        match self.speaking.as_mut().map(Child::try_wait) {
            Some(Ok(None)) => true,
            _ => {
                self.speaking = None;
                false
            }
        }
    }
    fn stop_speaking(&mut self) {
        if let Some(mut child) = self.speaking.take() {
            child.kill().ok();
            child.wait().ok();
        }
    }
    fn start_listening(&mut self) -> Result<(), SpeechError> {
        self.listener()?.start()
    }
    fn finish_listening(&mut self) -> Result<String, SpeechError> {
        self.listener()?.finish()
    }
    fn cancel_listening(&mut self) {
        if let Some(l) = self.listener.as_mut() {
            l.send("cancel").ok();
        }
    }
    fn levels(&mut self) -> Vec<f64> {
        self.listener.as_mut().map(HelperListener::peaks).unwrap_or_default()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn say_args_put_the_text_after_a_double_dash() {
        let e = NativeEngine::new(SayVoice { voice: Some("Samantha".into()), words_per_minute: Some(190) }, None);
        assert_eq!(e.say_args("-rm hi"), ["-v", "Samantha", "-r", "190", "--", "-rm hi"]);
    }

    #[test]
    fn it_reads_levels_and_the_transcript_from_a_helper_process() {
        // A shell script is the helper: it answers `stop` with a level and a transcript. No microphone is used.
        let script = r#"while read -r l; do case "$l" in *stop*) echo '{"type":"level","peak":0.5}'; echo '{"type":"transcript","text":" hello there "}';; esac; done"#;
        let mut e = NativeEngine::new(SayVoice::default(), Some(("/bin/sh".into(), vec!["-c".into(), script.into()])));
        e.start_listening().unwrap();
        assert_eq!(e.finish_listening().unwrap(), "hello there");
        // The level line came before the transcript, so `finish` dropped it; the contract only promises levels while recording.
        assert!(e.levels().is_empty());
    }

    #[test]
    fn a_missing_helper_gives_a_plain_error() {
        let mut e = NativeEngine::new(SayVoice::default(), None);
        assert!(e.start_listening().unwrap_err().0.contains("No dictation helper"));
    }
}
