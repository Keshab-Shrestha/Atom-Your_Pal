//! The UI state of the ARK app (ADR-278, docs/rust-migration-plan.md Phase 3).
//! `Model::apply` folds one island event (docs/island-protocol.md) into the state the views draw.
//! This crate has no window code, so its tests run without a GPU.

pub mod find;
mod model;

pub use model::{ApiStatus, BRIEF_SWITCHES, Approval, BrainNode, Memory, ChatItem, Conn, Helper, Job, JobState, Message, Model, Provider, Question, Role, Stats, ToolCall, ToolRow, ToolState, Work, WorkState};
