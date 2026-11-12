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
    /// The call runs only if the user says yes to `summary`. Without an approver it is refused.
    Ask { summary: String, reason: String },
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
    /// Folders where `write_file` may write. Empty: no writes.
    pub write_roots: Vec<PathBuf>,
}

impl FloorPolicy {
    pub fn new(allowed: &[&str], home: &Path, roots: Vec<PathBuf>, cwd: &Path) -> Self {
        Self { allowed: allowed.iter().map(|s| s.to_string()).collect(), home: home.into(), roots, cwd: cwd.into(), write_roots: Vec::new() }
    }

    pub fn with_write_roots(mut self, roots: Vec<PathBuf>) -> Self {
        self.write_roots = roots;
        self
    }

    fn check_write(&self, input: &Map<String, Value>) -> Decision {
        let Some(raw) = input.get("path").and_then(Value::as_str) else { return Decision::Deny("write_file needs a path".into()) };
        let Some(content) = input.get("content").and_then(Value::as_str) else { return Decision::Deny("write_file needs content".into()) };
        if content.len() > crate::actions::MAX_WRITE_BYTES {
            return Decision::Deny(format!("write_file writes at most {} bytes", crate::actions::MAX_WRITE_BYTES));
        }
        if let Some(problem) = floor::floor_problem(&self.home, &self.write_roots, &self.cwd, raw, true) {
            return Decision::Deny(problem);
        }
        let expanded = ark_core::policy::expand_home(raw, &self.home.to_string_lossy());
        let real = floor::realish(&self.cwd.join(expanded));
        if let Some(problem) = floor::secret_problem(&self.home, &real) {
            return Decision::Deny(problem);
        }
        let real_text = real.to_string_lossy();
        if !self.write_roots.iter().any(|root| ark_core::policy::is_inside(&root.to_string_lossy(), &real_text)) {
            return Decision::Deny(format!("{raw} is not inside a folder this chat may change."));
        }
        Decision::Ask { summary: format!("Write {} bytes to {raw}", content.len()), reason: "ARK changes files only after you say yes.".into() }
    }

    fn check_command(&self, input: &Map<String, Value>) -> Decision {
        use ark_core::policy::{CommandVerdict, classify_command};
        let Some(command) = input.get("command").and_then(Value::as_str) else { return Decision::Deny("run_command needs a command".into()) };
        match classify_command(command, "you") {
            CommandVerdict::Refuse { reason } => Decision::Deny(reason),
            // ponytail: there is no sandbox in Rust yet, so even a command that Node would run in its sandbox asks first.
            CommandVerdict::Ask { reason, .. } => Decision::Ask { summary: format!("Run: {command}"), reason: format!("This command {reason}.") },
            CommandVerdict::Allow => Decision::Ask { summary: format!("Run: {command}"), reason: "Commands run on this Mac without a sandbox, so ARK asks first.".into() },
        }
    }
}

impl Policy for FloorPolicy {
    fn check(&self, tool: &str, input: &Map<String, Value>) -> Decision {
        if !self.allowed.contains(tool) {
            return Decision::Deny(format!("the tool {tool} is not allowed"));
        }
        match tool {
            "write_file" => return self.check_write(input),
            "run_command" => return self.check_command(input),
            "read_file" => {}
            _ => return Decision::Allow,
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
