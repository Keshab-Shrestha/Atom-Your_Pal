//! ADR-278 Phase 2: the island protocol (docs/island-protocol.md, apps/mac/src/island-protocol.ts and
//! island-commands.ts) as serde types, and the line-delimited JSON codec.
//! One message is one JSON object on one line, UTF-8, ending with `\n`. Unknown fields are ignored on both sides.

pub mod commands;
pub mod events;
pub mod names;

pub use commands::{Command, Parsed, parse_command};
pub use events::{Event, PROTOCOL_VERSION};
