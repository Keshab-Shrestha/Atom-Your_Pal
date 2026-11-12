//! Tools that change things: `write_file` and `run_command`. They run only after the policy said `Ask` and the user said yes.
//! The policy (see `FloorPolicy`) has already checked the path or the command. These tools check again what they must
//! (defence twice) and keep the effect small: a size limit, a time limit, a capped output.

use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use ark_llm::ToolSpec;
use serde_json::{Map, Value, json};

use crate::{ToolRunner, floor};

pub const MAX_WRITE_BYTES: usize = 1_000_000;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_OUTPUT_BYTES: usize = 20_000;

/// The user's answer to a question from the policy. Blocking: the agent waits.
pub trait Approver: Send + Sync {
    fn approve(&self, summary: &str, reason: &str) -> bool;
}

pub struct ActionTools {
    pub home: PathBuf,
    pub write_roots: Vec<PathBuf>,
    pub cwd: PathBuf,
}

impl ToolRunner for ActionTools {
    fn specs(&self) -> Vec<ToolSpec> {
        vec![
            ToolSpec {
                name: "write_file".into(),
                description: "Writes a text file inside a folder this chat may change (replaces it). The user is asked first. Input: path, content.".into(),
                input_schema: json!({"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}),
            },
            ToolSpec {
                name: "run_command".into(),
                description: "Runs one shell command in the working folder and gives its output. The user is asked first. Input: command.".into(),
                input_schema: json!({"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}),
            },
        ]
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        match name {
            "write_file" => self.write_file(input.get("path").and_then(Value::as_str).ok_or("write_file needs a path")?, input.get("content").and_then(Value::as_str).ok_or("write_file needs content")?),
            "run_command" => self.run_command(input.get("command").and_then(Value::as_str).ok_or("run_command needs a command")?),
            other => Err(format!("unknown tool {other}")),
        }
    }
}

impl ActionTools {
    fn write_file(&self, raw: &str, content: &str) -> Result<String, String> {
        if content.len() > MAX_WRITE_BYTES {
            return Err(format!("too large: at most {MAX_WRITE_BYTES} bytes"));
        }
        if let Some(problem) = floor::floor_problem(&self.home, &self.write_roots, &self.cwd, raw, true) {
            return Err(problem);
        }
        let expanded = ark_core::policy::expand_home(raw, &self.home.to_string_lossy());
        let real = floor::realish(&self.cwd.join(expanded));
        let inside = self.write_roots.iter().any(|root| ark_core::policy::is_inside(&floor::realish(root).to_string_lossy(), &real.to_string_lossy()));
        if !inside {
            return Err(format!("{raw} is not inside a folder this chat may change."));
        }
        std::fs::write(&real, content).map_err(|e| format!("could not write {raw}: {e}"))?;
        Ok(format!("Wrote {} bytes to {raw}", content.len()))
    }

    fn run_command(&self, command: &str) -> Result<String, String> {
        // The same check as the policy, again: a refused command never starts.
        if let ark_core::policy::CommandVerdict::Refuse { reason } = ark_core::policy::classify_command(command, "you") {
            return Err(reason);
        }
        let Some(mut cmd) = crate::sandbox::command(command, &self.write_roots, &self.home, &self.cwd) else {
            return Err("the command sandbox is not available on this system, so the command was not run".into());
        };
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start the command: {e}"))?;
        let read = |pipe: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                if let Some(pipe) = pipe {
                    pipe.take(MAX_OUTPUT_BYTES as u64).read_to_end(&mut buf).ok();
                }
                String::from_utf8_lossy(&buf).into_owned()
            })
        };
        let out = read(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
        let err = read(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
        let started = Instant::now();
        let status = loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => break status,
                None if started.elapsed() > COMMAND_TIMEOUT => {
                    child.kill().ok();
                    child.wait().ok();
                    return Err(format!("the command ran longer than {} seconds and was stopped", COMMAND_TIMEOUT.as_secs()));
                }
                None => std::thread::sleep(Duration::from_millis(20)),
            }
        };
        let (out, err) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
        let text = format!("exit {}\n{out}{}{err}", status.code().map_or("signal".into(), |c| c.to_string()), if err.is_empty() { "" } else { "\n[stderr]\n" });
        if status.success() { Ok(text) } else { Err(text) }
    }
}

/// Several tool runners as one. The first that lists a name runs it.
pub struct Combined(pub Vec<Arc<dyn ToolRunner>>);

impl ToolRunner for Combined {
    fn specs(&self) -> Vec<ToolSpec> {
        self.0.iter().flat_map(|r| r.specs()).collect()
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        match self.0.iter().find(|r| r.specs().iter().any(|s| s.name == name)) {
            Some(runner) => runner.run(name, input),
            None => Err(format!("unknown tool {name}")),
        }
    }
}
