//! `ComputerTool`: the `ToolRunner` the agent loop calls after the policy said yes.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use ark_agent::ToolRunner;
use ark_llm::ToolSpec;
use serde_json::{Map, Value, json};

use crate::action::{Action, parse_action};
use crate::backend::Backend;

pub struct ComputerTool {
    backend: Mutex<Box<dyn Backend>>,
    halted: AtomicBool,
}

impl ComputerTool {
    pub fn new(backend: Box<dyn Backend>) -> ComputerTool {
        ComputerTool { backend: Mutex::new(backend), halted: AtomicBool::new(false) }
    }

    /// Stop: no more input until `resume`. The Stop button and Esc call it.
    pub fn halt(&self) {
        self.halted.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.halted.store(false, Ordering::SeqCst);
    }
}

impl ToolRunner for ComputerTool {
    fn specs(&self) -> Vec<ToolSpec> {
        vec![ToolSpec {
            name: "computer".into(),
            description: "Controls the user's Mac. Actions: status, screen (size), screenshot (PNG file), tree (Accessibility elements of the front app), point (x, y: show a marker), move, click, double_click (x, y in points), type (text), key (keys, like cmd+c), scroll (dx, dy). Every input action needs the user's yes.".into(),
            input_schema: json!({"type": "object", "properties": {
                "action": {"type": "string", "enum": ["status", "screen", "screenshot", "tree", "point", "move", "click", "double_click", "type", "key", "scroll"]},
                "x": {"type": "number"}, "y": {"type": "number"}, "text": {"type": "string"}, "keys": {"type": "string"}, "dx": {"type": "integer"}, "dy": {"type": "integer"}
            }, "required": ["action"]}),
        }]
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        if name != "computer" {
            return Err(format!("unknown tool {name}"));
        }
        let action = parse_action(input)?;
        let mut backend = self.backend.lock().map_err(|_| "The computer backend failed earlier.".to_string())?;
        let (w, h) = backend.screen_size();
        match &action {
            Action::Status => return Ok(format!("Computer control is ready. Screen {w:.0} x {h:.0} points.")),
            Action::Screen => return Ok(format!("Screen {w:.0} x {h:.0} points.")),
            Action::Screenshot => return backend.screenshot(),
            Action::Tree => return backend.tree(),
            Action::Point { x, y } => return backend.point(*x, *y).map(|()| "Marker shown.".into()),
            _ if self.halted.load(Ordering::SeqCst) => return Err("Computer control is stopped.".into()),
            Action::Move { x, y } | Action::Click { x, y, .. } if *x >= w || *y >= h => return Err(format!("({x:.0}, {y:.0}) is outside the screen ({w:.0} x {h:.0}).")),
            _ => {}
        }
        backend.perform(&action)?;
        Ok("Done.".into())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::backend::{DryRun, Effect};
    use crate::policy::ComputerPolicy;
    use ark_agent::{Decision, Policy};

    fn call(tool: &ComputerTool, v: Value) -> Result<String, String> {
        tool.run("computer", v.as_object().unwrap())
    }

    #[test]
    fn a_dry_run_records_each_input_and_posts_nothing() {
        let dry = DryRun::default();
        let effects = dry.effects.clone();
        let tool = ComputerTool::new(Box::new(dry));
        assert!(call(&tool, json!({"action": "status"})).unwrap().contains("1440 x 900"));
        call(&tool, json!({"action": "click", "x": 100, "y": 200})).unwrap();
        call(&tool, json!({"action": "type", "text": "hello"})).unwrap();
        call(&tool, json!({"action": "key", "keys": "cmd+c"})).unwrap();
        call(&tool, json!({"action": "scroll", "dy": -3})).unwrap();
        assert_eq!(*effects.lock().unwrap(), [Effect::Click { x: 100.0, y: 200.0, double: false }, Effect::Type("hello".into()), Effect::Key("cmd+c".into()), Effect::Scroll(0, -3)]);
    }

    /// A backend that answers the reading actions without a screen.
    struct Reader;
    impl Backend for Reader {
        fn screen_size(&self) -> (f64, f64) {
            (100.0, 100.0)
        }
        fn perform(&mut self, _: &Action) -> Result<(), String> {
            Ok(())
        }
        fn screenshot(&mut self) -> Result<String, String> {
            Ok("Screenshot saved at /tmp/a.png.".into())
        }
        fn tree(&mut self) -> Result<String, String> {
            Ok("AXWindow \"Notes\"".into())
        }
        fn point(&mut self, _: f64, _: f64) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn reading_actions_reach_the_backend_even_when_halted_and_the_dry_run_says_no() {
        let tool = ComputerTool::new(Box::new(Reader));
        tool.halt();
        assert!(call(&tool, json!({"action": "screenshot"})).unwrap().contains("/tmp/a.png"));
        assert!(call(&tool, json!({"action": "tree"})).unwrap().contains("AXWindow"));
        assert_eq!(call(&tool, json!({"action": "point", "x": 1, "y": 2})).unwrap(), "Marker shown.");
        let dry = ComputerTool::new(Box::new(DryRun::default()));
        assert!(call(&dry, json!({"action": "tree"})).unwrap_err().contains("live backend"));
        for a in ["screenshot", "tree"] {
            assert_eq!(ComputerPolicy.check("computer", json!({"action": a}).as_object().unwrap()), Decision::Allow);
        }
    }

    #[test]
    fn halt_and_the_screen_bounds_stop_input() {
        let dry = DryRun::default();
        let effects = dry.effects.clone();
        let tool = ComputerTool::new(Box::new(dry));
        assert!(call(&tool, json!({"action": "click", "x": 5000, "y": 1})).unwrap_err().contains("outside the screen"));
        tool.halt();
        assert_eq!(call(&tool, json!({"action": "type", "text": "x"})).unwrap_err(), "Computer control is stopped.");
        assert!(call(&tool, json!({"action": "status"})).is_ok(), "reading still works");
        tool.resume();
        call(&tool, json!({"action": "move", "x": 1, "y": 1})).unwrap();
        assert_eq!(effects.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_policy_asks_before_the_tool_would_run() {
        let input = json!({"action": "click", "x": 1, "y": 1});
        assert!(matches!(ComputerPolicy.check("computer", input.as_object().unwrap()), Decision::Ask { .. }));
        assert_eq!(ComputerTool::new(Box::new(DryRun::default())).specs()[0].name, "computer");
    }
}
