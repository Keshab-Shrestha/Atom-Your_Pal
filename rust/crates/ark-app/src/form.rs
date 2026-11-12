//! One small form for the text the app writes to the runtime: a soul, a new agent, a new task.
//! The form owns its fields; `submit` turns them into one command.

use ark_protocol::commands::{AgentKit, Soul};
use ark_protocol::Command;
use rune::TextEdit;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormKind {
    /// Edit the soul of this helper (id); the name stays.
    Soul { helper: String, name: String },
    NewAgent,
    /// A daily routine for this helper (id).
    Routine { helper: String },
    /// Write or change a brain note (`Some(id)` changes it).
    Note { id: Option<u64> },
    /// Make a project: `new` (an empty folder), `git` (a clone of a URL) or `github` (owner/repo).
    ProjectSource { source: &'static str },
    /// Rename this project (id).
    ProjectName { id: String },
    /// The owner's name: the welcome window (first run) or Settings.
    Owner { first_run: bool },
    /// Add a task for this helper (id).
    NewTask { helper: String },
}

pub struct Form {
    pub kind: FormKind,
    pub fields: Vec<TextEdit>,
    pub kit: AgentKit,
}

impl Form {
    pub fn title(&self) -> String {
        match &self.kind {
            FormKind::Soul { name, .. } => format!("Soul of {name}"),
            FormKind::NewAgent => "New agent".into(),
            FormKind::Routine { .. } => "New daily routine".into(),
            FormKind::Note { id: None } => "New note".into(),
            FormKind::Note { id: Some(_) } => "Edit note".into(),
            FormKind::ProjectSource { source: "new" } => "New empty project".into(),
            FormKind::ProjectSource { source: "git" } => "Clone a Git repository".into(),
            FormKind::ProjectSource { .. } => "Clone from GitHub".into(),
            FormKind::ProjectName { .. } => "Rename project".into(),
            FormKind::Owner { first_run: true } => "Welcome to ARK".into(),
            FormKind::Owner { first_run: false } => "Your name".into(),
            FormKind::NewTask { .. } => "New task".into(),
        }
    }

    /// The label of each field, in order.
    pub fn labels(&self) -> &'static [&'static str] {
        match self.kind {
            FormKind::Soul { .. } => &["Personality", "How it works", "Rules", "Lessons"],
            FormKind::NewAgent => &["Name", "Role", "Personality", "How it works", "Rules"],
            FormKind::NewTask { .. } => &["Task"],
            FormKind::Routine { .. } => &["Task", "Time each day (HH:MM, 24 hours)"],
            FormKind::Note { .. } => &["Title", "Note"],
            FormKind::ProjectSource { source: "new" } => &["Name", "Parent folder"],
            FormKind::ProjectSource { source: "git" } => &["Name", "Parent folder", "Repository URL"],
            FormKind::ProjectSource { .. } => &["Name", "Parent folder", "owner/repo"],
            FormKind::ProjectName { .. } => &["Name"],
            FormKind::Owner { .. } => &["What should ARK call you?"],
        }
    }

    fn fresh(kind: FormKind, texts: &[&str]) -> Form {
        let fields = texts.iter().map(|t| TextEdit::new(*t)).collect();
        Form { kind, fields, kit: AgentKit::Research }
    }

    pub fn soul(helper: &str, name: &str, soul: &[String; 4]) -> Form {
        let texts: Vec<&str> = soul.iter().map(String::as_str).collect();
        Form::fresh(FormKind::Soul { helper: helper.into(), name: name.into() }, &texts)
    }

    pub fn new_agent() -> Form {
        Form::fresh(FormKind::NewAgent, &["", "", "", "", ""])
    }

    pub fn owner(first_run: bool, current: &str) -> Form {
        Form::fresh(FormKind::Owner { first_run }, &[current])
    }

    pub fn project_name(id: &str, current: &str) -> Form {
        Form::fresh(FormKind::ProjectName { id: id.into() }, &[current])
    }

    pub fn project_source(source: &'static str) -> Form {
        let n = if source == "new" { 2 } else { 3 };
        Form::fresh(FormKind::ProjectSource { source }, &vec![""; n])
    }

    pub fn note(id: Option<u64>, title: &str, body: &str) -> Form {
        Form::fresh(FormKind::Note { id }, &[title, body])
    }

    pub fn routine(helper: &str) -> Form {
        Form::fresh(FormKind::Routine { helper: helper.into() }, &["", "08:00"])
    }

    pub fn new_task(helper: &str) -> Form {
        Form::fresh(FormKind::NewTask { helper: helper.into() }, &[""])
    }

    fn text(&self, i: usize) -> String {
        self.fields.get(i).map(|f| f.text.trim().to_owned()).unwrap_or_default()
    }

    /// The command to send, or why the form is not ready.
    pub fn submit(&self) -> Result<Command, &'static str> {
        match &self.kind {
            FormKind::Soul { helper, name } => Ok(Command::SoulSet {
                helper: helper.clone(),
                soul: Soul { name: name.clone(), personality: self.text(0), how_it_works: self.text(1), rules: self.text(2), lessons: self.text(3) },
            }),
            FormKind::NewAgent => {
                if self.text(0).is_empty() || self.text(1).is_empty() {
                    return Err("An agent needs a name and a role.");
                }
                Ok(Command::AgentCreate {
                    name: self.text(0),
                    role: self.text(1),
                    kit: self.kit,
                    personality: self.text(2),
                    how_it_works: self.text(3),
                    rules: self.text(4),
                    reports_to: None,
                })
            }
            FormKind::Owner { .. } => {
                if self.text(0).is_empty() {
                    return Err("Write a name, or choose Skip.");
                }
                Ok(Command::OwnerSet { name: self.text(0) })
            }
            FormKind::ProjectName { id } => {
                if self.text(0).is_empty() {
                    return Err("A project needs a name.");
                }
                Ok(Command::ProjectRename { id: id.clone(), name: self.text(0) })
            }
            FormKind::ProjectSource { source } => {
                let needs_remote = *source != "new";
                if self.text(0).is_empty() || !self.text(1).starts_with('/') || (needs_remote && self.text(2).is_empty()) {
                    return Err("Give a name, the full path of the parent folder (it starts with /)");
                }
                let mut fields = serde_json::json!({ "type": "project.create", "request": format!("ui-{}", self.text(0)), "source": source, "name": self.text(0), "path": self.text(1) });
                if needs_remote {
                    fields["remote"] = self.text(2).into();
                }
                Ok(Command::Other { kind: "project.create".into(), fields: fields.as_object().cloned().unwrap_or_default() })
            }
            FormKind::Note { id } => {
                if self.text(0).is_empty() {
                    return Err("A note needs a title.");
                }
                Ok(Command::BrainSave { id: *id, title: self.text(0), body: self.fields.get(1).map(|f| f.text.trim_end().to_owned()).unwrap_or_default() })
            }
            FormKind::Routine { helper } => {
                let minute = parse_time(&self.text(1)).ok_or("Write the time as HH:MM, for example 08:30.")?;
                if self.text(0).is_empty() {
                    return Err("Write what the routine does.");
                }
                Ok(Command::RoutineAdd(ark_protocol::commands::RoutineInput {
                    helper: helper.clone(),
                    task: self.text(0),
                    kind: ark_protocol::commands::RoutineKind::Daily,
                    minute: Some(minute),
                    weekday: None,
                    every: None,
                    start_at: None,
                    notify_telegram: None,
                    webhook: None,
                }))
            }
            FormKind::NewTask { helper } => {
                if self.text(0).is_empty() {
                    return Err("Write what the task is.");
                }
                Ok(Command::JobAdd { helper: helper.clone(), task: self.text(0), blocked_by: None, plan_first: None })
            }
        }
    }
}

/// "08:30" as minutes after midnight.
fn parse_time(text: &str) -> Option<u32> {
    let (h, m) = text.split_once(':')?;
    let (h, m) = (h.trim().parse::<u32>().ok()?, m.trim().parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_agent_needs_name_and_role() {
        let mut f = Form::new_agent();
        assert!(f.submit().is_err());
        f.fields[0] = TextEdit::new("Nova");
        f.fields[1] = TextEdit::new("writer");
        assert!(matches!(f.submit(), Ok(Command::AgentCreate { ref name, .. }) if name == "Nova"));
    }

    #[test]
    fn a_project_source_needs_a_name_a_full_path_and_for_a_clone_a_remote() {
        let mut f = Form::project_source("git");
        f.fields[0] = TextEdit::new("atom");
        f.fields[1] = TextEdit::new("relative/dir");
        assert!(f.submit().is_err());
        f.fields[1] = TextEdit::new("/Users/x/dev");
        assert!(f.submit().is_err(), "a clone needs a URL");
        f.fields[2] = TextEdit::new("https://example.com/a.git");
        assert!(matches!(f.submit(), Ok(Command::Other { ref kind, ref fields }) if kind == "project.create" && fields["remote"] == "https://example.com/a.git"));
    }

    #[test]
    fn a_routine_needs_a_task_and_a_real_time() {
        let mut f = Form::routine("sid");
        assert!(f.submit().is_err());
        f.fields[0] = TextEdit::new("Read the news");
        assert!(matches!(f.submit(), Ok(Command::RoutineAdd(ref r)) if r.minute == Some(480)));
        f.fields[1] = TextEdit::new("25:00");
        assert!(f.submit().is_err());
    }

    #[test]
    fn a_soul_keeps_the_name() {
        let f = Form::soul("h1", "Sid", &["p".into(), "h".into(), "r".into(), "l".into()]);
        assert!(matches!(f.submit(), Ok(Command::SoulSet { ref soul, .. }) if soul.name == "Sid" && soul.lessons == "l"));
    }
}
