//! The UI state of the ARK app (ADR-278, docs/rust-migration-plan.md Phase 3).
//! `Model::apply` folds one island event (docs/island-protocol.md) into the state the views draw.
//! This crate has no window code, so its tests run without a GPU.

mod model;

pub use model::{Approval, ChatItem, Conn, Message, Model, Question, Role, ToolCall, ToolState, Work, WorkState};
