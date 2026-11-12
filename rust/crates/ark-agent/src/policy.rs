//! The deterministic gate between the model and the tools. The model is never the authorization layer.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use ark_llm::ToolSpec;
use crate::floor;
use crate::tools::{TOOL_LIST, Tools};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Allow,
    Deny(String),
}

/// Decides each proposed tool call before it runs.
pub trait Policy: Send + Sync {
    fn check(&self, tool: &str, input: &Map<String, Value>) -> Decision;
}

/// The tools the loop can call.
pub trait ToolRunner: Send + Sync {
    fn specs(&self) -> Vec<ToolSpec>;
    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String>;
}

/// An allow-list of tool names (everything else is refused), plus the disk-reading floor for tools that name a path.
pub struct FloorPolicy {
    pub allowed: HashSet<String>,
    pub home: PathBuf,
    pub roots: Vec<PathBuf>,
    pub cwd: PathBuf,
}

impl FloorPolicy {
    pub fn new(allowed: &[&str], home: &Path, roots: Vec<PathBuf>, cwd: &Path) -> Self {
        Self { allowed: allowed.iter().map(|s| s.to_string()).collect(), home: home.into(), roots, cwd: cwd.into() }
    }
}

impl Policy for FloorPolicy {
    fn check(&self, tool: &str, input: &Map<String, Value>) -> Decision {
        if !self.allowed.contains(tool) {
            return Decision::Deny(format!("the tool {tool} is not allowed"));
        }
        if tool != "read_file" {
            return Decision::Allow;
        }
        let Some(raw) = input.get("path").and_then(Value::as_str) else { return Decision::Deny("read_file needs a path".into()) };
        if let Some(problem) = floor::floor_problem(&self.home, &self.roots, &self.cwd, raw, false) {
            return Decision::Deny(problem);
        }
        let expanded = ark_core::policy::expand_home(raw, &self.home.to_string_lossy());
        let real = floor::realish(&self.cwd.join(expanded));
        floor::secret_problem(&self.home, &real).map_or(Decision::Allow, Decision::Deny)
    }
}

/// `current_time` and `read_file` from `ark-runtime`.
pub struct RuntimeTools(pub Tools);

impl ToolRunner for RuntimeTools {
    fn specs(&self) -> Vec<ToolSpec> {
        TOOL_LIST
            .iter()
            .map(|(name, description)| {
                let (props, required) = match *name {
                    "read_file" => (json!({"path": {"type": "string"}}), json!(["path"])),
                    _ => (json!({"timezone": {"type": "string"}}), json!([])),
                };
                ToolSpec { name: (*name).into(), description: (*description).into(), input_schema: json!({"type": "object", "properties": props, "required": required}) }
            })
            .collect()
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        self.0.call(name, input)
    }
}
