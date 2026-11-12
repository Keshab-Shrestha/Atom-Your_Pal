//! The state of the later screens: workflows, plugins, skills hub, local backup, reply drafts, plans and the
//! point-at overlay. Each part folds one island event (docs/island-protocol.md). Nothing here holds a secret.

use serde_json::{Map, Value};

fn text(map: &Map<String, Value>, key: &str) -> String {
    map.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn flag(map: &Map<String, Value>, key: &str) -> bool {
    map.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn int(map: &Map<String, Value>, key: &str) -> u64 {
    map.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn items<'a>(map: &'a Map<String, Value>, key: &str) -> impl Iterator<Item = &'a Map<String, Value>> {
    map.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object)
}

fn strings(map: &Map<String, Value>, key: &str) -> Vec<String> {
    map.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_owned)).collect()
}

fn opt(map: &Map<String, Value>, key: &str) -> Option<String> {
    Some(text(map, key)).filter(|s| !s.is_empty())
}

const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// One automation (`workflows` event).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// "schedule", "event" or "manual".
    pub trigger_kind: String,
    pub trigger: String,
    /// (agent id, task) of each step.
    pub steps: Vec<(String, String)>,
    pub last_run: Option<String>,
    /// The event as it came, to save the workflow again with one change.
    pub raw: Map<String, Value>,
}

fn clock(minute: u64) -> String {
    format!("{}:{:02}", minute / 60, minute % 60)
}

fn trigger_words(kind: &str, trigger: &Map<String, Value>) -> String {
    let schedule = trigger.get("schedule").and_then(Value::as_object);
    match (kind, schedule) {
        ("schedule", Some(s)) => match text(s, "kind").as_str() {
            "daily" => format!("Every day at {}", clock(int(s, "minute"))),
            "weekly" => format!("Every {} at {}", WEEKDAYS[(int(s, "weekday") % 7) as usize], clock(int(s, "minute"))),
            "hours" => format!("Every {} hours", int(s, "every").max(1)),
            _ => "On a schedule".into(),
        },
        ("schedule", None) => "On a schedule".into(),
        ("event", _) if text(trigger, "event") == "task.failed" => "When a Board task fails".into(),
        ("event", _) => "When a Board task finishes".into(),
        _ => "By hand".into(),
    }
}

fn parse_workflows(map: &Map<String, Value>) -> Vec<Workflow> {
    items(map, "workflows")
        .map(|w| {
            let trigger = w.get("trigger").and_then(Value::as_object).cloned().unwrap_or_default();
            let kind = text(&trigger, "kind");
            Workflow {
                id: text(w, "id"),
                name: text(w, "name"),
                enabled: flag(w, "enabled"),
                trigger: trigger_words(&kind, &trigger),
                trigger_kind: kind,
                steps: items(w, "steps").map(|s| (text(s, "helper"), text(s, "task"))).collect(),
                last_run: opt(w, "lastRunAt"),
                raw: w.clone(),
            }
        })
        .collect()
}

/// One MCP server of the Plugins page.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct McpServer {
    pub id: u64,
    pub name: String,
    /// The command line, or the URL.
    pub target: String,
    pub enabled: bool,
    pub trusted: bool,
    pub tools: Vec<String>,
    pub tested: bool,
    pub problem: Option<String>,
}

/// A skill Tinker drafted from a done task, waiting for an answer.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SkillDraft {
    pub id: u64,
    pub helper: String,
    pub name: String,
    pub description: String,
    pub preview: String,
    pub state: String,
}

/// A change Tinker proposes to one of ARK's skills.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SkillEdit {
    pub id: u64,
    pub skill: String,
    pub reason: String,
    pub before: String,
    pub after: String,
    pub state: String,
}

/// A skill from the hub's last search.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HubResult {
    pub name: String,
    pub description: String,
    pub repo: String,
    pub path: String,
    pub sha: String,
    pub source: u64,
}

/// A hub skill that waits for the owner's OK. `flags` are what the scan noticed: (severity, kind, excerpt).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HubPending {
    pub id: u64,
    pub update: bool,
    pub name: String,
    pub description: String,
    pub repo: String,
    pub text: String,
    pub flags: Vec<(String, String, String)>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Hub {
    pub results: Vec<HubResult>,
    pub pending: Vec<HubPending>,
    /// (name, repo)
    pub installed: Vec<(String, String)>,
    pub message: Option<String>,
}

/// One part of a work plan.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Portion {
    pub n: u64,
    pub agent: String,
    pub task: String,
    pub after: Vec<u64>,
    pub job: Option<u64>,
    pub state: String,
}

/// A work plan: one goal split into parts (ADR-111).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkPlan {
    pub id: u64,
    pub goal: String,
    pub complete: bool,
    pub stuck: bool,
    pub portions: Vec<Portion>,
}

/// A task whose first run only plans, and the plan waits for the owner (`planStatus` "awaiting").
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TaskPlan {
    pub job: u64,
    pub helper: String,
    pub task: String,
    pub summary: String,
}

impl Portion {
    /// "Waits for P1", "Working", "Done" ...
    pub fn state_text(&self, all: &[Portion]) -> String {
        match self.state.as_str() {
            "waiting" => {
                let open: Vec<String> = self.after.iter().filter(|n| all.iter().find(|p| p.n == **n).is_none_or(|p| p.state != "done")).map(|n| format!("P{n}")).collect();
                if open.is_empty() { "Ready".into() } else { format!("Waits for {}", open.join(", ")) }
            }
            "running" => "Working".into(),
            "done" => "Done".into(),
            "failed" => "Failed".into(),
            "stopped" => "Stopped".into(),
            "blocked" => "Blocked".into(),
            other => other.to_owned(),
        }
    }
}

/// The local backup session (`local.backup` event): the reviewed revision, the saved address and the temporary turns.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Backup {
    pub revision: String,
    pub endpoint: String,
    pub model: String,
    /// (listed, text verified) after a probe.
    pub ready: Option<(bool, bool)>,
    pub turns: Vec<(String, String)>,
    pub usage: Option<String>,
    pub error: Option<String>,
}

/// The answer to a reply draft (`reply.result`) and the notes the private lookup found (`reply.context`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Drafts {
    pub text: Option<String>,
    pub error: Option<String>,
    /// (id, title, revision, excerpt)
    pub items: Vec<(String, String, String, String)>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Extras {
    pub workflows: Option<Vec<Workflow>>,
    pub workflow_problem: Option<String>,
    pub mcp: Vec<McpServer>,
    pub skill_drafts: Vec<SkillDraft>,
    pub skill_edits: Vec<SkillEdit>,
    pub hub: Option<Hub>,
    pub plans: Vec<WorkPlan>,
    pub task_plans: Vec<TaskPlan>,
    pub backup: Option<Backup>,
    pub drafts: Drafts,
    /// The place `computer.point` shows: x, y, w, h and the label.
    pub point: Option<(f64, f64, f64, f64, String)>,
}

impl Extras {
    /// Folds one event; true when it was one of ours.
    pub fn apply(&mut self, kind: &str, map: &Map<String, Value>) -> bool {
        match kind {
            "workflows" => {
                self.workflows = Some(parse_workflows(map));
                self.workflow_problem = opt(map, "problem");
            }
            "helpers" => self.apply_helpers(map),
            "local.backup" => self.apply_backup(map),
            "reply.result" => {
                self.drafts.text = opt(map, "text");
                self.drafts.error = opt(map, "error");
            }
            "reply.context" => self.drafts.items = items(map, "items").map(|i| (text(i, "id"), text(i, "title"), text(i, "revision"), text(i, "text"))).collect(),
            "computer.point" => self.point = ["x", "y", "w", "h"].iter().map(|k| map.get(*k).and_then(Value::as_f64)).collect::<Option<Vec<f64>>>().filter(|v| v[2] > 0.0 && v[3] > 0.0).map(|v| (v[0], v[1], v[2], v[3], text(map, "label"))),
            "computer.end" => self.point = None,
            _ => return false,
        }
        true
    }

    fn apply_helpers(&mut self, map: &Map<String, Value>) {
        self.mcp = items(map, "mcp")
            .map(|m| McpServer {
                id: int(m, "id"),
                name: text(m, "name"),
                target: if text(m, "kind") == "url" { text(m, "url") } else { std::iter::once(text(m, "command")).chain(strings(m, "args")).collect::<Vec<_>>().join(" ") },
                enabled: flag(m, "enabled"),
                trusted: flag(m, "trusted"),
                tools: strings(m, "tools"),
                tested: m.get("testedAt").is_some_and(Value::is_string),
                problem: opt(m, "problem"),
            })
            .collect();
        self.skill_drafts = items(map, "skillDrafts").map(|d| SkillDraft { id: int(d, "id"), helper: text(d, "helper"), name: text(d, "name"), description: text(d, "description"), preview: text(d, "preview"), state: text(d, "state") }).collect();
        self.skill_edits = items(map, "skillEdits").map(|e| SkillEdit { id: int(e, "id"), skill: text(e, "skill"), reason: text(e, "reason"), before: text(e, "before"), after: text(e, "after"), state: text(e, "state") }).collect();
        self.hub = map.get("skillHub").and_then(Value::as_object).map(parse_hub);
        self.plans = items(map, "plans")
            .map(|p| WorkPlan {
                id: int(p, "id"),
                goal: text(p, "goal"),
                complete: flag(p, "complete"),
                stuck: flag(p, "stuck"),
                portions: items(p, "portions")
                    .map(|q| Portion { n: int(q, "n"), agent: text(q, "agent"), task: text(q, "task"), after: q.get("after").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64).collect(), job: q.get("job").and_then(Value::as_u64), state: text(q, "state") })
                    .collect(),
            })
            .collect();
        self.task_plans = items(map, "helpers")
            .flat_map(|h| items(h, "jobs").filter(|j| text(j, "planStatus") == "awaiting" && text(j, "state") == "queued").map(move |j| TaskPlan { job: int(j, "id"), helper: text(h, "name"), task: text(j, "task"), summary: text(j, "planSummary") }))
            .collect();
    }

    fn apply_backup(&mut self, map: &Map<String, Value>) {
        let config = map.get("config").and_then(Value::as_object);
        self.backup = Some(Backup {
            revision: text(map, "revision"),
            endpoint: config.map(|c| text(c, "endpoint")).unwrap_or_default(),
            model: config.map(|c| text(c, "model")).unwrap_or_default(),
            ready: map.get("readiness").and_then(Value::as_object).map(|r| (flag(r, "listed"), flag(r, "textVerified"))),
            turns: items(map, "turns").map(|t| (text(t, "role"), text(t, "content"))).collect(),
            usage: map.get("usage").and_then(Value::as_object).map(|u| format!("{} in, {} out, {} ms", int(u, "input"), int(u, "output"), int(u, "durationMs"))),
            error: opt(map, "error"),
        });
    }
}

fn parse_hub(h: &Map<String, Value>) -> Hub {
    Hub {
        results: items(h, "results").map(|r| HubResult { name: text(r, "name"), description: text(r, "description"), repo: text(r, "repo"), path: text(r, "path"), sha: text(r, "sha"), source: int(r, "source") }).collect(),
        pending: items(h, "pending")
            .map(|p| HubPending {
                id: int(p, "id"),
                update: text(p, "kind") == "update",
                name: text(p, "name"),
                description: text(p, "description"),
                repo: text(p, "repo"),
                text: text(p, "text"),
                flags: items(p, "flags").map(|f| (text(f, "severity"), text(f, "kind"), text(f, "excerpt"))).collect(),
            })
            .collect(),
        installed: items(h, "installed").map(|i| (text(i, "name"), text(i, "repo"))).collect(),
        message: opt(h, "message"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(extras: &mut Extras, line: &str) {
        let v: Value = serde_json::from_str(line).unwrap_or_default();
        let map = v.as_object().cloned().unwrap_or_default();
        let kind = text(&map, "type");
        extras.apply(&kind, &map);
    }

    #[test]
    fn workflows_name_their_trigger_in_words() {
        let mut e = Extras::default();
        fold(&mut e, r#"{"type":"workflows","workflows":[{"id":"w1","name":"Morning news","enabled":true,"trigger":{"kind":"schedule","schedule":{"kind":"daily","minute":485}},"steps":[{"helper":"sid","task":"Collect"},{"helper":"quill","task":"Write"}]},{"id":"w2","name":"B","enabled":false,"trigger":{"kind":"event","event":"task.failed"},"steps":[]}]}"#);
        let list = e.workflows.unwrap_or_default();
        assert_eq!(list[0].trigger, "Every day at 8:05");
        assert_eq!(list[0].steps.len(), 2);
        assert_eq!(list[1].trigger, "When a Board task fails");
    }

    #[test]
    fn helpers_carry_plugins_plans_and_the_hub() {
        let mut e = Extras::default();
        fold(&mut e, r#"{"type":"helpers","helpers":[{"id":"sid","name":"Sid","jobs":[{"id":7,"task":"Port it","state":"queued","planStatus":"awaiting","planSummary":"Three steps"}]}],"mcp":[{"id":1,"name":"files","kind":"command","command":"npx","args":["srv"],"enabled":true,"trusted":false,"tools":["read"]}],"plans":[{"id":3,"goal":"Ship","portions":[{"n":1,"agent":"sid","task":"A","state":"done"},{"n":2,"agent":"quill","task":"B","after":[1],"state":"waiting"},{"n":3,"agent":"x","task":"C","after":[2],"state":"waiting"}]}],"skillHub":{"results":[{"name":"pdf","repo":"a/b","path":"p","sha":"abc","source":1}],"pending":[{"id":2,"kind":"new","name":"pdf","text":"body","flags":[{"kind":"shell","severity":"warn","excerpt":"rm"}]}],"installed":[{"name":"x","repo":"a/b"}]}}"#);
        assert_eq!(e.mcp[0].target, "npx srv");
        assert_eq!(e.task_plans[0].summary, "Three steps");
        let p = &e.plans[0];
        assert_eq!(p.portions[1].state_text(&p.portions), "Ready");
        assert_eq!(p.portions[2].state_text(&p.portions), "Waits for P2");
        let hub = e.hub.unwrap_or_default();
        assert_eq!((hub.results.len(), hub.pending[0].flags.len(), hub.installed.len()), (1, 1, 1));
    }

    #[test]
    fn backup_drafts_and_point_events_fold() {
        let mut e = Extras::default();
        fold(&mut e, r#"{"type":"local.backup","revision":"r1","config":{"endpoint":"http://127.0.0.1:1234","model":"m"},"turns":[{"role":"user","content":"hi"}],"readiness":{"listed":true,"textVerified":false},"usage":{"input":3,"output":4,"durationMs":9,"truncated":false}}"#);
        assert_eq!(e.backup.as_ref().map(|b| b.ready), Some(Some((true, false))));
        fold(&mut e, r#"{"type":"reply.result","id":"d","text":"Sure."}"#);
        assert_eq!(e.drafts.text.as_deref(), Some("Sure."));
        fold(&mut e, r#"{"type":"reply.result","id":"d","error":"offline"}"#);
        assert_eq!((e.drafts.text.clone(), e.drafts.error.clone()), (None, Some("offline".into())));
        fold(&mut e, r#"{"type":"computer.point","x":10,"y":20,"w":30,"h":40,"label":"the button"}"#);
        assert_eq!(e.point.as_ref().map(|p| p.4.as_str()), Some("the button"));
        fold(&mut e, r#"{"type":"computer.end"}"#);
        assert!(e.point.is_none());
    }
}
