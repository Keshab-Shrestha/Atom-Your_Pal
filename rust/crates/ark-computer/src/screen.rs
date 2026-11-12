//! The client of the `ark-screen` helper (`helpers/ark-screen`): screenshot, Accessibility tree and point marker.
//!
//! Contract: one JSON object a line on stdio. ARK writes `{"id":1,"cmd":"size"}`; the helper answers
//! `{"id":1,"ok":true,...}` or `{"id":1,"ok":false,"error":"..."}`. The helper posts no input; input stays in `Live`.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::Duration;

use serde_json::{Value, json};

const REPLY_WAIT: Duration = Duration::from_secs(20);

pub struct ScreenHelper {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
    next_id: u64,
}

impl ScreenHelper {
    pub fn spawn(program: &Path, args: &[String]) -> Result<ScreenHelper, String> {
        let mut child = Command::new(program).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("The screen helper did not start: {e}"))?;
        let stdin = child.stdin.take().ok_or("The screen helper has no input.")?;
        let stdout = child.stdout.take().ok_or("The screen helper has no output.")?;
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<Value>(&line)
                    && tx.send(v).is_err()
                {
                    break;
                }
            }
        });
        Ok(ScreenHelper { child, stdin, lines, next_id: 1 })
    }

    /// Sends one command and waits for the reply with the same id. `fields` is a JSON object merged into the request.
    pub fn request(&mut self, cmd: &str, fields: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let mut req = json!({"id": id, "cmd": cmd});
        if let (Some(o), Some(extra)) = (req.as_object_mut(), fields.as_object()) {
            o.extend(extra.clone());
        }
        writeln!(self.stdin, "{req}").and_then(|()| self.stdin.flush()).map_err(|e| format!("The screen helper stopped: {e}"))?;
        loop {
            match self.lines.recv_timeout(REPLY_WAIT) {
                Ok(v) if v["id"] == id => {
                    return if v["ok"] == true { Ok(v) } else { Err(v["error"].as_str().unwrap_or("The screen helper failed.").to_string()) };
                }
                Ok(_) => {} // a late reply of an earlier request
                Err(RecvTimeoutError::Timeout) => return Err("The screen helper took too long.".into()),
                Err(RecvTimeoutError::Disconnected) => return Err("The screen helper stopped.".into()),
            }
        }
    }
}

impl Drop for ScreenHelper {
    fn drop(&mut self) {
        // Ignore failures: the process may be gone already.
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// A shell script is the helper: it answers `size`, `screenshot` and a failing `tree`. No screen is read.
    const SCRIPT: &str = r#"while read -r l; do
id=$(printf '%s' "$l" | sed 's/.*"id":\([0-9]*\).*/\1/')
case "$l" in
*'"size"'*) echo "{\"id\":$id,\"ok\":true,\"width\":1440,\"height\":900}";;
*'"screenshot"'*) echo '{"id":99,"ok":true}'; echo "{\"id\":$id,\"ok\":true,\"path\":\"/tmp/x.png\",\"width\":2,\"height\":2}";;
*) echo "{\"id\":$id,\"ok\":false,\"error\":\"Accessibility is not allowed\"}";;
esac; done"#;

    #[test]
    fn it_matches_replies_by_id_and_returns_errors() {
        let mut h = ScreenHelper::spawn(Path::new("/bin/sh"), &["-c".into(), SCRIPT.into()]).unwrap();
        assert_eq!(h.request("size", json!({})).unwrap()["width"], 1440);
        assert_eq!(h.request("screenshot", json!({"path": "/tmp/x.png"})).unwrap()["path"], "/tmp/x.png");
        assert_eq!(h.request("tree", json!({})).unwrap_err(), "Accessibility is not allowed");
    }

    #[test]
    fn a_missing_helper_gives_a_plain_error() {
        assert!(ScreenHelper::spawn(Path::new("/nonexistent/ark-screen"), &[]).err().unwrap().contains("did not start"));
    }
}
