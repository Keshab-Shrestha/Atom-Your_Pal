//! Commands from the island (island -> runtime). The typed variants are the commands whose shape
//! apps/mac/src/island-commands.ts spells out inline; every other accepted command type is `Other`.
//! The typed shape is structural only: the Node runtime keeps the full validation of what it receives.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::names::COMMAND_NAMES;

/// The brief settings a `brief.set` may change; only the given fields are present.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BriefChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reminders: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weather: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_you: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telegram: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spoken: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation_daily_limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation_note_ids: Option<Vec<u64>>,
}

/// A worker's soul (`soul.set`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Soul {
    pub name: String,
    pub personality: String,
    pub how_it_works: String,
    pub rules: String,
    pub lessons: String,
}

/// The `routine.add` and `routine.update` fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInput {
    pub helper: String,
    pub task: String,
    pub kind: RoutineKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekday: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_telegram: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutineKind {
    Daily,
    Weekly,
    Hours,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKit {
    Research,
    Folders,
    Think,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestCaseKind {
    Soul,
    Skill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpKind {
    Command,
    Url,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComputerDecisionProvider {
    Off,
    Jev,
    Laya,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Command {
    #[serde(rename = "panels.list")]
    PanelsList,
    #[serde(rename = "watches.get")]
    WatchesGet,
    #[serde(rename = "stats.get")]
    StatsGet,
    #[serde(rename = "improvements.get")]
    ImprovementsGet,
    #[serde(rename = "improvements.run")]
    ImprovementsRun,
    #[serde(rename = "improvements.set")]
    ImprovementsSet { enabled: bool },
    #[serde(rename = "improvement.dismiss")]
    ImprovementDismiss { id: String },
    #[serde(rename = "improvement.fixing")]
    ImprovementFixing { id: String },
    #[serde(rename = "apps.list")]
    AppsList,
    #[serde(rename = "app.open")]
    AppOpen { id: String },
    #[serde(rename = "app.remove")]
    AppRemove { id: String },
    #[serde(rename = "app.call")]
    AppCall {
        app: String,
        req: String,
        op: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
    },
    #[serde(rename = "watch.remove")]
    WatchRemove { id: String },
    #[serde(rename = "panel.save")]
    PanelSave { panel: Map<String, Value> },
    #[serde(rename = "panel.delete")]
    PanelDelete { id: String },
    #[serde(rename = "workflows.list")]
    WorkflowsList,
    #[serde(rename = "workflow.save")]
    WorkflowSave { workflow: Map<String, Value> },
    #[serde(rename = "workflow.delete")]
    WorkflowDelete { id: String },
    #[serde(rename = "workflow.run")]
    WorkflowRun { id: String },
    #[serde(rename = "chat.work.watch")]
    ChatWorkWatch,
    #[serde(rename = "chat.question.answer")]
    ChatQuestionAnswer {
        chat: String,
        turn: String,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    #[serde(rename = "chat.access")]
    ChatAccess { id: String, mode: String, expected: String },
    #[serde(rename = "chat.defaults")]
    ChatDefaults { access: String, effort: String },
    #[serde(rename = "talk.start")]
    TalkStart,
    #[serde(rename = "talk.send")]
    TalkSend,
    #[serde(rename = "talk.cancel")]
    TalkCancel,
    #[serde(rename = "conversation.reset")]
    ConversationReset,
    #[serde(rename = "model.set")]
    ModelSet { provider: String, model: String },
    #[serde(rename = "model.refresh")]
    ModelRefresh,
    #[serde(rename = "chat.reasoning")]
    ChatReasoning { id: String, provider: String, model: String, effort: String },
    #[serde(rename = "chat.model")]
    ChatModel { id: String, provider: String, model: String },
    #[serde(rename = "approval.answer", rename_all = "camelCase")]
    ApprovalAnswer {
        id: String,
        approved: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remember_file: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        remember_task: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        review_token: Option<String>,
    },
    #[serde(rename = "memory.list")]
    MemoryList,
    #[serde(rename = "brain.get")]
    BrainGet,
    #[serde(rename = "brain.note")]
    BrainNote { id: u64 },
    #[serde(rename = "brain.save")]
    BrainSave {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        title: String,
        body: String,
    },
    #[serde(rename = "brain.delete")]
    BrainDelete { id: u64 },
    #[serde(rename = "brain.search")]
    BrainSearch { query: String },
    #[serde(rename = "commands.list")]
    CommandsList,
    #[serde(rename = "skill.get")]
    SkillGet { name: String },
    #[serde(rename = "skill.save")]
    SkillSave { name: String, text: String },
    #[serde(rename = "chats.list")]
    ChatsList,
    #[serde(rename = "chats.export")]
    ChatsExport { folder: String },
    #[serde(rename = "chats.clear")]
    ChatsClear,
    #[serde(rename = "chat.new", rename_all = "camelCase")]
    ChatNew {
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
    },
    #[serde(rename = "chat.rename")]
    ChatRename { id: String, title: String },
    #[serde(rename = "project.add")]
    ProjectAdd { name: String, path: String },
    #[serde(rename = "project.rename")]
    ProjectRename { id: String, name: String },
    #[serde(rename = "project.remove", rename_all = "camelCase")]
    ProjectRemove {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        delete_chats: Option<bool>,
    },
    #[serde(rename = "project.archive")]
    ProjectArchive { id: String, archived: bool },
    #[serde(rename = "project.model")]
    ProjectModel { id: String, provider: String, model: String },
    #[serde(rename = "project.web")]
    ProjectWeb { id: String, web: bool },
    #[serde(rename = "chat.open")]
    ChatOpen { id: String },
    #[serde(rename = "chat.delete")]
    ChatDelete { id: String },
    #[serde(rename = "memory.keepChat")]
    MemoryKeepChat { id: String },
    #[serde(rename = "memory.dropChat")]
    MemoryDropChat { id: String },
    #[serde(rename = "git.list")]
    GitList,
    #[serde(rename = "git.push")]
    GitPush { repo: String, branch: String },
    #[serde(rename = "git.diff")]
    GitDiff { repo: String, branch: String },
    #[serde(rename = "memory.forget")]
    MemoryForget { id: u64 },
    #[serde(rename = "memory.clear")]
    MemoryClear,
    #[serde(rename = "suggestions.get")]
    SuggestionsGet,
    #[serde(rename = "suggestions.accept")]
    SuggestionsAccept {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    #[serde(rename = "suggestions.deny")]
    SuggestionsDeny { id: u64 },
    #[serde(rename = "suggestions.undo")]
    SuggestionsUndo { id: u64 },
    #[serde(rename = "suggestions.set")]
    SuggestionsSet { enabled: bool },
    #[serde(rename = "text.edit")]
    TextEdit {
        id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        selection: Option<[u64; 2]>,
        instruction: String,
    },
    #[serde(rename = "text.edit.cancel")]
    TextEditCancel { id: String },
    #[serde(rename = "brief.get")]
    BriefGet,
    #[serde(rename = "brief.run")]
    BriefRun,
    #[serde(rename = "brief.set")]
    BriefSet { change: BriefChange },
    #[serde(rename = "brief.note")]
    BriefNote { id: u64, included: bool },
    #[serde(rename = "text.send")]
    TextSend {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        files: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        notes: Option<Vec<u64>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        request: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat: Option<String>,
    },
    #[serde(rename = "episode.forget")]
    EpisodeForget { id: u64 },
    #[serde(rename = "episode.clear")]
    EpisodeClear,
    #[serde(rename = "context.window", rename_all = "camelCase")]
    ContextWindow { bundle_id: String, name: String },
    #[serde(rename = "helpers.list")]
    HelpersList,
    #[serde(rename = "speech.set")]
    SpeechSet {
        reports: bool,
        updates: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        chime: Option<bool>,
    },
    #[serde(rename = "telegram.set")]
    TelegramSet { push: bool },
    #[serde(rename = "api.set")]
    ApiSet { on: bool },
    #[serde(rename = "owner.set")]
    OwnerSet { name: String },
    #[serde(rename = "api.regenerate")]
    ApiRegenerate,
    #[serde(rename = "tools.scan")]
    ToolsScan,
    #[serde(rename = "ai.programs.scan")]
    AiProgramsScan,
    #[serde(rename = "ai.programs.allow")]
    AiProgramsAllow { id: String, allowed: bool },
    #[serde(rename = "chat.warm")]
    ChatWarm,
    #[serde(rename = "helper.set")]
    HelperSet { helper: String, app: String },
    #[serde(rename = "job.add", rename_all = "camelCase")]
    JobAdd {
        helper: String,
        task: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        blocked_by: Option<Vec<u64>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        plan_first: Option<bool>,
    },
    #[serde(rename = "plan.approve")]
    PlanApprove { id: u64 },
    #[serde(rename = "plan.reject")]
    PlanReject { id: u64 },
    #[serde(rename = "plan.dismiss")]
    PlanDismiss { id: u64 },
    #[serde(rename = "helper.planFirst")]
    HelperPlanFirst { helper: String, on: bool },
    #[serde(rename = "helper.browser")]
    HelperBrowser { helper: String, on: bool },
    #[serde(rename = "routine.delete")]
    RoutineDelete { id: u64 },
    #[serde(rename = "routine.pause")]
    RoutinePause { id: u64, paused: bool },
    #[serde(rename = "routine.add")]
    RoutineAdd(RoutineInput),
    #[serde(rename = "routine.update")]
    RoutineUpdate {
        id: u64,
        #[serde(flatten)]
        routine: RoutineInput,
    },
    #[serde(rename = "grant.add")]
    GrantAdd { helper: String, path: String },
    #[serde(rename = "grant.remove")]
    GrantRemove { helper: String, path: String },
    #[serde(rename = "helper.skills")]
    HelperSkills { helper: String, skills: Vec<String> },
    #[serde(rename = "job.rate")]
    JobRate {
        id: u64,
        good: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        comment: Option<String>,
    },
    #[serde(rename = "job.open")]
    JobOpen { id: u64 },
    #[serde(rename = "job.retry")]
    JobRetry { id: u64 },
    #[serde(rename = "mcp.add")]
    McpAdd {
        name: String,
        kind: McpKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        args: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        env: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        transport: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        headers: Option<Vec<String>>,
    },
    #[serde(rename = "mcp.remove")]
    McpRemove { id: u64 },
    #[serde(rename = "mcp.set")]
    McpSet {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        enabled: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        trusted: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        workers: Option<Vec<String>>,
    },
    #[serde(rename = "mcp.test")]
    McpTest { id: u64 },
    #[serde(rename = "agent.create", rename_all = "camelCase")]
    AgentCreate {
        name: String,
        role: String,
        kit: AgentKit,
        personality: String,
        how_it_works: String,
        rules: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reports_to: Option<String>,
    },
    #[serde(rename = "agent.remove")]
    AgentRemove { id: String },
    #[serde(rename = "agent.pause")]
    AgentPause { id: String, paused: bool },
    #[serde(rename = "proposal.accept")]
    ProposalAccept { id: u64 },
    #[serde(rename = "proposal.reject")]
    ProposalReject { id: u64 },
    #[serde(rename = "proposal.undo")]
    ProposalUndo { id: u64 },
    #[serde(rename = "testcase.save", rename_all = "camelCase")]
    TestcaseSave { job_id: u64, kind: TestCaseKind, target: String },
    #[serde(rename = "testcase.delete")]
    TestcaseDelete { id: u64 },
    #[serde(rename = "testcase.run", rename_all = "camelCase")]
    TestcaseRun { proposal_kind: TestCaseKind, id: u64 },
    #[serde(rename = "skill.make")]
    SkillMake { id: u64 },
    #[serde(rename = "skill.approve")]
    SkillApprove { id: u64 },
    #[serde(rename = "skill.reject")]
    SkillReject { id: u64 },
    #[serde(rename = "skill.edit.accept")]
    SkillEditAccept { id: u64 },
    #[serde(rename = "skill.edit.reject")]
    SkillEditReject { id: u64 },
    #[serde(rename = "skill.edit.undo")]
    SkillEditUndo { id: u64 },
    #[serde(rename = "skill.hub.search")]
    SkillHubSearch { query: String },
    #[serde(rename = "skill.hub.preview")]
    SkillHubPreview { source: u64, path: String },
    #[serde(rename = "skill.hub.approve")]
    SkillHubApprove { id: u64 },
    #[serde(rename = "skill.hub.reject")]
    SkillHubReject { id: u64 },
    #[serde(rename = "skill.hub.uninstall")]
    SkillHubUninstall {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        force: Option<bool>,
    },
    #[serde(rename = "skill.hub.update")]
    SkillHubUpdate { name: String },
    #[serde(rename = "job.block", rename_all = "camelCase")]
    JobBlock { id: u64, blocked_by: Vec<u64> },
    #[serde(rename = "comment.add")]
    CommentAdd { id: u64, text: String },
    #[serde(rename = "job.steer")]
    JobSteer { id: u64, text: String },
    #[serde(rename = "job.interrupt")]
    JobInterrupt { id: u64 },
    #[serde(rename = "job.undo")]
    JobUndo {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        force: Option<bool>,
    },
    #[serde(rename = "search")]
    Search { query: String },
    #[serde(rename = "job.label.add")]
    JobLabelAdd { id: u64, label: String },
    #[serde(rename = "job.label.remove")]
    JobLabelRemove { id: u64, label: String },
    #[serde(rename = "thread.get")]
    ThreadGet { id: u64 },
    #[serde(rename = "job.stop")]
    JobStop { id: u64 },
    #[serde(rename = "job.fresh")]
    JobFresh { id: u64 },
    #[serde(rename = "job.delete")]
    JobDelete { id: u64 },
    #[serde(rename = "helper.pin")]
    HelperPin { helper: String, model: String },
    #[serde(rename = "helper.codex.pin")]
    HelperCodexPin { helper: String, model: String },
    #[serde(rename = "helper.reportsTo")]
    HelperReportsTo { helper: String, lead: Option<String> },
    #[serde(rename = "helpers.settings", rename_all = "camelCase")]
    HelpersSettings {
        #[serde(skip_serializing_if = "Option::is_none")]
        allow_large: Option<bool>,
    },
    #[serde(rename = "computer.decisions")]
    ComputerDecisions { provider: ComputerDecisionProvider, backup: bool },
    #[serde(rename = "computer.mode")]
    ComputerMode { foreground: bool },
    #[serde(rename = "soul.set")]
    SoulSet { helper: String, soul: Soul },
    #[serde(rename = "soul.restore")]
    SoulRestore { helper: String, version: u64 },
    #[serde(rename = "quit")]
    Quit,
    /// An accepted command type whose shape lives in another TypeScript module (project, workspace, foreground, ...).
    /// It keeps every field as it came.
    #[serde(skip)]
    Other { kind: String, fields: Map<String, Value> },
}

/// The result of reading one line from the island.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    Blank,
    Command(Box<Command>),
    /// The text for a `protocol` error event, as the TypeScript parser words it for the cases both share.
    Error(String),
}

/// Parses one line. Never fails: a bad line becomes `Parsed::Error`.
pub fn parse_command(line: &str) -> Parsed {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Parsed::Blank;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return Parsed::Error("Command is not valid JSON.".into());
    };
    let Value::Object(fields) = value else {
        return Parsed::Error("Command must be a JSON object.".into());
    };
    let Some(kind) = fields.get("type").and_then(Value::as_str).map(str::to_owned) else {
        return Parsed::Error("Command has no \"type\".".into());
    };
    if !COMMAND_NAMES.contains(&kind.as_str()) {
        let shown: String = kind.chars().take(40).collect();
        return Parsed::Error(format!("Unknown command \"{shown}\"."));
    }
    match serde_json::from_value::<Command>(Value::Object(fields.clone())) {
        Ok(command) => Parsed::Command(Box::new(command)),
        Err(error) if error.to_string().contains("unknown variant") => Parsed::Command(Box::new(Command::Other { kind, fields })),
        Err(error) => Parsed::Error(format!("Invalid {kind} command: {error}")),
    }
}

impl Command {
    /// The `type` of this command.
    pub fn kind(&self) -> String {
        match self {
            Command::Other { kind, .. } => kind.clone(),
            typed => serde_json::to_value(typed).ok().and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_owned)).unwrap_or_default(),
        }
    }

    /// The command as one JSON line, ending with a newline.
    pub fn to_line(&self) -> String {
        let value = match self {
            Command::Other { fields, .. } => Value::Object(fields.clone()),
            typed => serde_json::to_value(typed).unwrap_or(Value::Null),
        };
        format!("{value}\n")
    }
}
