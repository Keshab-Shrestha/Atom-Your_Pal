//! The `helpers` event (ADR-278 Phase 4, slice 6): the snapshot of the Helpers page, built from `helpers.db` and the
//! soul files. A port of `sendHelpers` in `apps/mac/src/island.ts`. Some parts live only in Node's memory (the installed
//! apps, the plan's models, the skills folders, the skill hub, Paperclip, the stuck dot of a task). Who reports to whom is
//! read from `org.json` (`helpers_org`).
//! Rust takes them from the last `helpers` event that Node sent (`cached`); the apps and the skills it reads from the folders; with none, or with a stuck dot in it, `build`
//! gives `None` and Node answers.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{Map, Value, json};

use crate::{helpers_catalog, helpers_extras, helpers_org, helpers_jobs, helpers_plans, helpers_roster, helpers_routines, helpers_tests, helpers_usage};

/// The keys of the event that Node alone knows.
const NODE_KEYS: [&str; 3] = ["models", "skillHub", "paperclip"];

/// The folders the apps and the skills are listed from.
#[derive(Clone, Debug)]
pub struct Host {
    pub app_dirs: Vec<PathBuf>,
    pub home: Option<PathBuf>,
    /// The owner's skills (`~/.claude/skills`) and ARK's (`data/skills`).
    pub user_skills: PathBuf,
    pub ark_skills: Option<PathBuf>,
}

impl Host {
    /// The folders of this Mac for the helpers file `db`: the standard Applications folders, `~/.claude/skills`, and `skills` beside `db`.
    pub fn of_this_mac(db: &Path) -> Host {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        Host {
            app_dirs: helpers_catalog::APP_DIRS.iter().map(PathBuf::from).collect(),
            user_skills: home.clone().unwrap_or_default().join(".claude").join("skills"),
            home,
            ark_skills: Some(db.with_file_name("skills")),
        }
    }
}

/// Every table and column the event reads. A file with another schema is answered by Node.
pub fn schema() -> Vec<(&'static str, &'static [&'static str])> {
    [helpers_roster::SCHEMA, helpers_routines::SCHEMA, helpers_jobs::SCHEMA, helpers_tests::SCHEMA, helpers_extras::SCHEMA, helpers_plans::SCHEMA, helpers_usage::SCHEMA, &[("skill_hub", &["name"])]].concat()
}

/// A read-only connection with the schema checked.
pub fn open_read_only(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    conn.busy_timeout(crate::store::BUSY_TIMEOUT).ok()?;
    crate::store::check_schema(&conn, &schema()).ok()?;
    Some(conn)
}

/// The names of the skills installed from the hub.
fn hub_names(conn: &Connection) -> Option<Vec<String>> {
    conn.prepare("SELECT name FROM skill_hub ORDER BY name").ok()?.query_map([], |r| r.get(0)).ok()?.collect::<Result<_, _>>().ok()
}

fn has_stuck_dot(cached: &Value) -> bool {
    cached["helpers"].as_array().is_some_and(|hs| hs.iter().any(|h| h["jobs"].as_array().is_some_and(|js| js.iter().any(|j| j.get("quietSince").is_some()))))
}

/// The event for the state of `conn` at `now`, or `None` when Node must answer.
pub fn build(conn: &Connection, agents_dir: &Path, now: &jiff::Zoned, cached: &Value, host: &Host) -> Option<Value> {
    if has_stuck_dot(cached) {
        return None;
    }
    build_with(conn, agents_dir, now, cached, host, None)
}

/// Like `build`, with the stuck dots of Rust (`quiet`): Node's copy is then not needed for them.
pub fn build_with(conn: &Connection, agents_dir: &Path, now: &jiff::Zoned, cached: &Value, host: &Host, quiet: Option<&crate::helpers_quiet::Quiet>) -> Option<Value> {
    if cached["type"] != "helpers" {
        return None;
    }
    let (members, problems) = helpers_roster::roster(conn, agents_dir)?;
    // Only agents that are not Tinker sit in the chart.
    let chart_ids: Vec<String> = members.iter().filter(|m| m.role != "improver").map(|m| m.id.clone()).collect();
    let chart = helpers_org::resolve(&helpers_org::read_raw(&agents_dir.with_file_name("org.json")), &chart_ids);
    let mut helpers = Vec::new();
    let mut names = Vec::new();
    for m in &members {
        let mut view = helpers_roster::member_core(conn, m)?;
        names.push((m.id.clone(), view["name"].as_str()?.to_string()));
        view["routines"] = Value::Array(helpers_routines::routines_of(conn, &m.id, now)?);
        view["proposals"] = Value::Array(helpers_tests::proposals_of(conn, &m.id)?);
        view["jobs"] = Value::Array(helpers_jobs::jobs_of(conn, &m.id)?);
        if let Some(lead) = chart.get(&m.id) {
            view["reportsTo"] = json!(lead);
        }
        helpers.push(view);
    }
    let name_of = |id: &str| names.iter().find(|n| n.0 == id).map_or_else(|| id.to_string(), |n| n.1.clone());
    let plans = helpers_plans::plans(conn, &name_of)?;
    let mut event = Map::new();
    event.insert("type".into(), json!("helpers"));
    event.insert("helpers".into(), Value::Array(helpers));
    let dirs: Vec<&Path> = host.app_dirs.iter().map(PathBuf::as_path).collect();
    event.insert("apps".into(), helpers_catalog::apps(&dirs, host.home.as_deref()));
    event.insert("skills".into(), helpers_catalog::skills(&host.user_skills, host.ark_skills.as_deref(), &hub_names(conn)?));
    for key in NODE_KEYS {
        if let Some(value) = cached.get(key) {
            event.insert(key.into(), value.clone());
        }
    }
    event.insert("allowLarge".into(), json!(helpers_extras::allow_large(conn)?));
    event.insert("skillDrafts".into(), Value::Array(helpers_extras::skill_drafts(conn)?));
    event.insert("skillEdits".into(), Value::Array(helpers_extras::skill_edits(conn)?));
    event.insert("testCases".into(), Value::Array(helpers_tests::test_cases(conn)?));
    event.insert("mcp".into(), Value::Array(helpers_extras::mcp(conn)?));
    event.insert("usage".into(), helpers_usage::summary(conn, now, &name_of)?);
    if !plans.is_empty() {
        event.insert("plans".into(), Value::Array(plans));
    }
    if !problems.is_empty() {
        event.insert("agentProblems".into(), Value::Array(problems));
    }
    let mut event = Value::Object(event);
    if let Some(quiet) = quiet {
        quiet.mark(&mut event);
    }
    Some(event)
}
