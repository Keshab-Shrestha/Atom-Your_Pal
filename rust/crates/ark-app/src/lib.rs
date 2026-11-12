//! The ARK app in Rust (ADR-278 Phase 3): the bridge to the runtime, the window and a fake runtime for tests.

pub mod app;
pub mod bridge;
pub mod fake;
pub mod form;
pub mod launch;
#[cfg(target_os = "macos")]
pub mod mac;
pub mod overlay;
pub mod palette;
pub mod prefs;
pub mod recorder;
pub mod view;
