//! The check groups of the Phase 0.2 spike (ADR-278). `main.rs` selects one with `--check`;
//! `embed-host/` links this library as a static library for the embed check.

pub mod log;
#[cfg(target_os = "macos")]
mod mac;
pub mod text;
pub mod views;
pub mod windows;

#[cfg(target_os = "macos")]
pub mod embed;
