//! The team side of the Telegram bot in Rust (ADR-278 Phase 4): the Needs-you items, `/tasks`, `/report` and the team buttons.
//! Ports of `needsYou`, `answerNeed`, `tasksText` and `reportText` in `apps/mac/src/telegram-bot.ts`, read from `helpers.db`.
//! A button that Rust cannot do itself yet (approving a plan or a hub skill, accepting a proposal, retrying a chat task) gives
//! `None`, and the bot says that the team is not available.

use std::path::PathBuf;

use ark_telegram::Button;
use ark_telegram::bot::Need;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::{helpers_event, helpers_extras, helpers_jobs, helpers_life, helpers_roster, helpers_skills, helpers_tests, helpers_write};

const REPORT_CHARS: usize = 3500;
const TASKS_SHOWN: usize = 20;
const TITLE_CHARS: usize = 80;

/// One worker: its name, its tasks and its proposals.
type Owner = (String, Vec<Value>, Vec<Value>);

/// Where the team lives: the helpers file, the agent folders and the two skill folders.
#[derive(Debug, Clone)]
pub struct Team {
    pub db: PathBuf,
    pub agents: PathBuf,
    pub ark_skills: Option<PathBuf>,
    pub user_skills: PathBuf,
}

fn flat(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cut(text: &str, max: usize) -> String {
    if text.chars().count() > max { format!("{}…", text.chars().take(max - 1).collect::<String>()) } else { text.to_string() }
}

fn title_of(job: &Value) -> String {
    cut(&flat(job["title"].as_str().or_else(|| job["task"].as_str()).unwrap_or("")), TITLE_CHARS)
}

fn yes_no(yes: &str, no: &str, data: &str) -> Vec<Vec<Button>> {
    vec![vec![Button { text: yes.into(), data: format!("{data}:1") }, Button { text: no.into(), data: format!("{data}:0") }]]
}

/// The window's line for a test run, or "" when there are none (`testLine`).
fn test_line(conn: &Connection, kind: &str, id: i64) -> String {
    let Some(Some(t)) = helpers_tests::tests_of(conn, kind, id) else { return String::new() };
    let n = |key: &str| t[key].as_i64().unwrap_or(0);
    if n("running") > 0 {
        return "\nTest cases: running…".into();
    }
    let mut parts: Vec<String> = [("better", "better"), ("same", "same"), ("worse", "worse"), ("failed", "failed")].iter().filter(|(k, _)| n(k) > 0).map(|(k, w)| format!("{} {w}", n(k))).collect();
    if n("notRun") > 0 {
        parts.push(format!("{} not run", n("notRun")));
    }
    if parts.is_empty() { String::new() } else { format!("\nTest cases: {}", parts.join(", ")) }
}

impl Team {
    /// The team as `store.list()` has it: each worker's name and tasks, and its proposals.
    fn owners(&self, conn: &Connection) -> Option<Vec<Owner>> {
        let (members, _) = helpers_roster::roster(conn, &self.agents)?;
        members
            .iter()
            .map(|m| {
                let core = helpers_roster::member_core(conn, m)?;
                Some((core["name"].as_str()?.to_string(), helpers_jobs::jobs_of(conn, &m.id)?, helpers_tests::proposals_of(conn, &m.id)?))
            })
            .collect()
    }

    /// `needsYou`: `questions` (already Needs, built by the bot from the approvals) first, then the team's items in the window's order.
    pub fn needs(&self, questions: Vec<Need>) -> Vec<Need> {
        let mut all = questions;
        if let Some(conn) = helpers_event::open_read_only(&self.db) {
            all.extend(self.team_needs(&conn).unwrap_or_default());
        }
        all
    }

    fn team_needs(&self, conn: &Connection) -> Option<Vec<Need>> {
        let owners = self.owners(conn)?;
        let (mut plans, mut failures, mut proposals) = (Vec::new(), Vec::new(), Vec::new());
        for (name, jobs, props) in &owners {
            for job in jobs {
                let id = job["id"].as_i64()?;
                if job["state"] == "queued" && job["planStatus"] == "awaiting" {
                    let summary = job["planSummary"].as_str().unwrap_or("A plan waits for your OK.");
                    plans.push(Need { key: format!("plan-{id}"), push: true, text: format!("{name}'s plan for #{id} {}:\n{summary}", title_of(job)), buttons: yes_no("Approve", "Reject", &format!("p:{id}")) });
                    continue;
                }
                if job["state"] == "failed" && job.get("retriedAs").is_none() {
                    let interrupted = job["recoveryNeeded"] == true;
                    let text = format!(
                        "{name}'s task #{id} {} {}: {}{}",
                        title_of(job),
                        if interrupted { "was interrupted; its outcome is unconfirmed" } else { "failed" },
                        job["error"].as_str().unwrap_or("It ended with a problem."),
                        if interrupted { " Review this attempt in ARK on your Mac before retrying." } else { "" }
                    );
                    let buttons = if interrupted { Vec::new() } else { vec![vec![Button { text: "Retry".into(), data: format!("r:{id}") }]] };
                    failures.push((id, Need { key: format!("failed-{id}"), push: false, text, buttons }));
                }
            }
            for p in props.iter().filter(|p| p["state"] == "pending") {
                let id = p["id"].as_i64()?;
                let text = format!("Tinker suggests a new {} for {name}:\n{}\nWhy: {}{}", p["field"].as_str()?, cut(p["text"].as_str()?, 600), cut(p["reason"].as_str()?, 300), test_line(conn, "soul", id));
                proposals.push(Need { key: format!("proposal-{id}"), push: true, text, buttons: yes_no("Accept", "Reject", &format!("s:{id}")) });
            }
        }
        let drafts = helpers_extras::skill_drafts(conn)?.into_iter().filter(|d| d["state"] == "pending").map(|d| {
            let id = d["id"].as_i64()?;
            Some(Need { key: format!("skill-draft-{id}"), push: true, text: format!("Tinker drafted a skill: {}\n{}", d["name"].as_str()?, cut(d["description"].as_str()?, 300)), buttons: yes_no("Approve", "Reject", &format!("d:{id}")) })
        });
        let edits = helpers_extras::skill_edits(conn)?.into_iter().filter(|e| e["state"] == "pending").map(|e| {
            let id = e["id"].as_i64()?;
            Some(Need { key: format!("skill-edit-{id}"), push: true, text: format!("Tinker suggests an edit to the {} skill.\nWhy: {}{}", e["skill"].as_str()?, cut(e["reason"].as_str()?, 300), test_line(conn, "skill", id)), buttons: yes_no("Accept", "Reject", &format!("e:{id}")) })
        });
        let hub: Vec<Need> = helpers_skills::hub_payload(conn, None)?
            .and_then(|h| h["pending"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|p| {
                let mut kinds: Vec<&str> = Vec::new();
                for f in p["flags"].as_array()? {
                    let kind = f["kind"].as_str()?;
                    if !kinds.contains(&kind) {
                        kinds.push(kind);
                    }
                }
                let head = if p["kind"] == "update" { format!("A newer version of the {} skill is ready", p["name"].as_str()?) } else { format!("Skill from the hub: {}", p["name"].as_str()?) };
                let id = p["id"].as_i64()?;
                let flags = if kinds.is_empty() { "none".to_string() } else { kinds.join(", ") };
                let text = format!("{head}\n{} @ {}\nFlags: {flags}\nRead it in the ARK window before you approve.", p["repo"].as_str()?, p["sha"].as_str()?.chars().take(7).collect::<String>());
                Some(Need { key: format!("skill-hub-{id}"), push: true, text, buttons: yes_no("Approve", "Reject", &format!("h:{id}")) })
            })
            .collect();
        failures.sort_by_key(|(id, _)| std::cmp::Reverse(*id));
        let mut all = plans;
        all.extend(proposals);
        all.extend(drafts.chain(edits).collect::<Option<Vec<_>>>()?);
        all.extend(hub);
        all.extend(failures.into_iter().map(|(_, n)| n));
        Some(all)
    }

    /// `tasksText`.
    pub fn tasks(&self) -> Option<String> {
        let conn = helpers_event::open_read_only(&self.db)?;
        let owners = self.owners(&conn)?;
        let lines = |state: &str| -> Vec<String> {
            owners
                .iter()
                .flat_map(|(name, jobs, _)| {
                    jobs.iter().filter(|j| j["state"] == state).map(move |j| {
                        let step = j["step"].as_str().filter(|_| state == "running").map(|s| format!(" ({})", cut(&flat(s), 60))).unwrap_or_default();
                        format!("#{} {name}: {}{step}", j["id"], title_of(j))
                    })
                })
                .collect()
        };
        let (running, queued) = (lines("running"), lines("queued"));
        if running.is_empty() && queued.is_empty() {
            return Some("No task runs or waits to run.".into());
        }
        let mut all: Vec<String> = Vec::new();
        if !running.is_empty() {
            all.push("Running:".into());
            all.extend(running.iter().cloned());
        }
        if !queued.is_empty() {
            all.push(if running.is_empty() { "Waiting:" } else { "\nWaiting:" }.into());
            all.extend(queued);
        }
        if all.len() > TASKS_SHOWN {
            let more = format!("… and {} more in the ARK window.", all.len() - TASKS_SHOWN);
            all.truncate(TASKS_SHOWN);
            all.push(more);
        }
        Some(all.join("\n"))
    }

    /// `reportText`.
    pub fn report(&self, id: u64) -> Option<String> {
        let conn = helpers_event::open_read_only(&self.db)?;
        let found: Option<(String, String, String)> = conn.query_row("SELECT title, summary, body FROM reports WHERE job_id = ?", [id as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().ok()?;
        let Some((title, summary, body)) = found else { return Some(format!("Task #{id} has no report.")) };
        let whole = format!("{title}\n\n{summary}\n\n{body}");
        Some(if whole.chars().count() > REPORT_CHARS { format!("{}…\n\nThe rest is in the ARK window.", whole.chars().take(REPORT_CHARS - 1).collect::<String>()) } else { whole })
    }

    /// `answerNeed` for the team buttons Rust does itself. `None` for one it does not; a refusal says so in short words.
    pub fn press(&self, data: &str) -> Option<String> {
        let mut parts = data.split(':');
        let (kind, id, ok) = (parts.next()?, parts.next()?.parse::<i64>().ok()?, parts.next() == Some("1"));
        let conn = crate::store::open_read_write(&self.db).ok()?;
        let refused = || Some("That did not work. Open the ARK window.".to_string());
        let write = |command: Value| helpers_write::apply(&conn, &command).is_some();
        let ark = self.ark_skills.as_deref();
        let skill = |type_: &str| ark.is_some_and(|ark| helpers_skills::apply(&conn, &serde_json::json!({ "type": type_, "id": id }), ark, &self.user_skills).is_some());
        match (kind, ok) {
            ("d", true) => Some(if skill("skill.approve") { "Skill approved.".into() } else { return refused() }),
            ("d", false) => Some(if write(serde_json::json!({ "type": "skill.reject", "id": id })) { "Skill rejected.".into() } else { return refused() }),
            ("e", true) => Some(if skill("skill.edit.accept") { "Edit accepted.".into() } else { return refused() }),
            ("e", false) => Some(if write(serde_json::json!({ "type": "skill.edit.reject", "id": id })) { "Edit rejected.".into() } else { return refused() }),
            ("s", false) => Some(if write(serde_json::json!({ "type": "proposal.reject", "id": id })) { "Change rejected.".into() } else { return refused() }),
            ("r", _) => {
                let job = helpers_life::get(&conn, id)?;
                if conn.query_row("SELECT COALESCE(recovery_needed, 0) FROM jobs WHERE id = ?", [id], |r| r.get::<_, i64>(0)).ok()? == 1 {
                    return Some("Review the interrupted attempt in ARK on your Mac before retrying.".into());
                }
                // A task that a chat started needs the runtime's retry dispatcher (`helpers_retry` queues it, nothing starts it yet).
                job.chat_id.is_none().then(|| helpers_life::retry(&conn, id).ok()).flatten().map(|()| "Retry requested.".to_string())
            }
            _ => None,
        }
    }
}
