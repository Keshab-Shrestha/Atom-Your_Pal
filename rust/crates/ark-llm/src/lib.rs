//! The LLM Gateway (CLAUDE.md rule 7, ADR-278). Every model call in ARK goes through a [`Provider`].
//! A provider gets a [`Request`] and returns a stream of [`Event`]s. Tool calls come out whole, not in pieces.
//! The model only proposes tool calls. The agent loop decides (CLAUDE.md rule 12).
#![forbid(unsafe_code)]

pub mod anthropic;
mod sse;
mod types;

pub use types::*;
