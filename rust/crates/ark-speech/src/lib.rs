//! Speech in and out for the Rust runtime (ADR-278, `docs/rust-migration-plan.md` section 5(b)).
//! `SpeechEngine` is the one boundary. `NativeEngine` speaks with the macOS `say` program and listens through the
//! Parakeet helper process (`ark-dictation`, the owner chose Parakeet only). `FakeEngine` is for tests.
//! `Talk` turns the `talk.*` commands into the island events.

mod engine;
mod native;
mod talk;

pub use engine::{FakeEngine, SpeechEngine, SpeechError};
pub use native::{HelperListener, NativeEngine, SayVoice};
pub use talk::Talk;
