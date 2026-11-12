//! Events to the island (runtime -> island). The typed variants are the events whose shape
//! apps/mac/src/island-protocol.ts spells out inline and that are small. Large payloads (`helpers`, `chats`,
//! `thread`, ...) and events defined in other TypeScript modules stay `Other`, with every field kept.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoopState {
    Idle,
    Listening,
    Transcribing,
    Thinking,
    Speaking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorStage {
    Microphone,
    Transcription,
    Model,
    Speech,
    Config,
    Protocol,
    Settings,
    Runtime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    TooShort,
    MicStarting,
    NoSpeech,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    Note,
    Memory,
    Episode,
    Chat,
    Project,
    Entity,
}

/// A note that links to this one, or that this one links to (`ghost` is only on links out).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrainLink {
    pub id: u64,
    pub title: String,
    pub kind: NoteKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ghost: Option<bool>,
    pub auto: bool,
}

/// The folder copy a note comes from; the metadata only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSource {
    pub path: String,
    pub relative_path: String,
    pub checked_at: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainNoteItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<NoteSource>,
    pub id: u64,
    pub title: String,
    pub body: String,
    pub kind: NoteKind,
    pub ghost: bool,
    pub tags: Vec<String>,
    pub links: Vec<BrainLink>,
    pub backlinks: Vec<BrainLink>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrainHit {
    pub id: u64,
    pub title: String,
    pub kind: NoteKind,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "ready")]
    Ready {
        protocol: u32,
        provider: String,
        model: String,
        microphone: String,
        voice: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        telegram: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        computer: Option<bool>,
    },
    #[serde(rename = "state")]
    State { state: LoopState },
    #[serde(rename = "api")]
    Api {
        on: bool,
        port: u16,
        #[serde(rename = "tokenFile")]
        token_file: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "mic.ready")]
    MicReady,
    #[serde(rename = "mic.level")]
    MicLevel { peak: Number },
    #[serde(rename = "mic.silent")]
    MicSilent { microphone: String },
    #[serde(rename = "transcript")]
    Transcript { text: String },
    #[serde(rename = "reply")]
    Reply { text: String },
    /// A piece of the reply while the model writes it. The final `reply` still carries the whole text.
    #[serde(rename = "reply.delta")]
    ReplyDelta { text: String },
    #[serde(rename = "turn.complete", rename_all = "camelCase")]
    TurnComplete {
        speech_ms: u64,
        transcription_ms: u64,
        model_ms: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        first_sound_ms: Option<u64>,
    },
    #[serde(rename = "notice")]
    Notice { kind: NoticeKind, message: String },
    #[serde(rename = "conversation.reset", rename_all = "camelCase")]
    ConversationReset {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
    },
    #[serde(rename = "computer.step")]
    ComputerStep {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lane: Option<String>,
    },
    #[serde(rename = "computer.cursor")]
    ComputerCursor {
        x: Number,
        y: Number,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lane: Option<String>,
    },
    #[serde(rename = "computer.end")]
    ComputerEnd,
    #[serde(rename = "settings.open")]
    SettingsOpen,
    #[serde(rename = "media.key")]
    MediaKey { key: String },
    #[serde(rename = "approval.closed")]
    ApprovalClosed { id: String },
    #[serde(rename = "timer")]
    Timer { id: u64, label: String, message: String },
    #[serde(rename = "brain.note")]
    BrainNote { note: BrainNoteItem },
    #[serde(rename = "brain.hits")]
    BrainHits { query: String, hits: Vec<BrainHit> },
    #[serde(rename = "worker.line")]
    WorkerLine { line: String },
    #[serde(rename = "error")]
    Error {
        stage: ErrorStage,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        retryable: Option<bool>,
    },
    /// Any other event. It keeps every field as it came.
    #[serde(skip)]
    Other(Map<String, Value>),
}

impl Event {
    /// A `protocol` or `settings` error event with no model fields.
    pub fn error(stage: ErrorStage, message: impl Into<String>) -> Event {
        Event::Error { stage, message: message.into(), kind: None, retryable: None }
    }

    /// The event as one JSON line, ending with a newline (like `encodeEvent` in TypeScript).
    pub fn to_line(&self) -> String {
        let value = match self {
            Event::Other(fields) => Value::Object(fields.clone()),
            typed => serde_json::to_value(typed).unwrap_or(Value::Null),
        };
        format!("{value}\n")
    }

    /// Reads one event line. A type this crate does not model, or one whose fields do not fit, is `Other`;
    /// only text that is not a JSON object fails.
    pub fn parse(line: &str) -> Result<Event, String> {
        let value: Value = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
        let Value::Object(fields) = value else {
            return Err("an event must be a JSON object".into());
        };
        Ok(serde_json::from_value::<Event>(Value::Object(fields.clone())).unwrap_or(Event::Other(fields)))
    }
}
