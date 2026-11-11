//! ARK's pure logic (Phase 1 of ADR-278, docs/rust-migration-plan.md). No IO: each function takes its input and
//! returns its answer. Each module ports one TypeScript or Swift source; the module comment names it.
#![forbid(unsafe_code)]

pub mod diff;
pub mod jobs;
pub mod js;
pub mod org;
pub mod policy;
pub mod questions;
pub mod visual;

