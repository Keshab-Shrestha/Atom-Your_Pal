//! The Rust `computer` tool (ADR-278; replaces the Cua driver client of `services/tool-engine/src/computer` in a later step).
//!
//! Layers, from the model down:
//! 1. `ComputerPolicy` (`ark_agent::Policy`) decides each call before it runs: reading is allowed, every input is an
//!    approval question (no answer means no), and a short list of system keys is refused. The model is never the authorization layer.
//! 2. `ComputerTool` (`ToolRunner`) parses the call and checks it (bounds, sizes), then calls a `Backend`. `halt()` stops all input.
//! 3. `Backend`: `DryRun` records what would happen and touches nothing. `Live` posts CGEvents and needs two separate
//!    steps to arm (see `Live::arm`). No test and no default path builds `Live`.
//!
//! Not in this step: screenshots and the Accessibility element tree (`look`), the point marker, learned shortcuts, lanes.
//! Those stay with the Cua driver until they are ported.

mod action;
mod backend;
mod policy;
mod tool;

pub use action::{Action, parse_action};
pub use backend::{Backend, DryRun, Effect};
#[cfg(target_os = "macos")]
pub use backend::Live;
pub use policy::ComputerPolicy;
pub use tool::ComputerTool;
