//! Who reports to whom: the chart rules of `apps/mac/src/org.ts` (ADR-272: depth, loops, the can-call gate, hand
//! back) and the window's chart of `apps/mac/island/Sources/ArkIslandCore/OrgChart.swift` (levels, drop check,
//! layout). The org.json store reads the disk and moves in Phase 2.

use std::collections::{BTreeMap, HashMap};

use crate::js;

/// Agent id to its lead's id. An agent with no entry reports to ARK.
pub type ReportsTo = BTreeMap<String, String>;

/// The most levels below ARK: ARK → lead → lead → lead → worker.
pub const MAX_ORG_DEPTH: usize = 4;
/// ADR-272: the most agents one task from the main thread may start below it, at every level together.
pub const MAX_TEAM_CHILDREN: usize = 6;
pub const HAND_BACK: &str = "Hand back:";
pub const HAND_BACK_CHARS: usize = 300;

/// An agent's id and role, as the team lists them.
pub struct Member<'a> {
    pub id: &'a str,
    pub role: &'a str,
}

/// The agents that can sit in the chart: every agent but the improver (it only reviews).
pub fn org_agent_ids(list: &[Member<'_>]) -> Vec<String> {
    list.iter().filter(|m| m.role != "improver").map(|m| m.id.to_string()).collect()
}

/// The leads above an agent, nearest first; `None` when the chain loops.
fn leads_of(agent: &str, map: &ReportsTo) -> Option<Vec<String>> {
    let mut chain: Vec<String> = Vec::new();
    let mut lead = map.get(agent);
    while let Some(l) = lead {
        if l == agent || chain.contains(l) {
            return None;
        }
        chain.push(l.clone());
        lead = map.get(l);
    }
    Some(chain)
}

fn fits(agent: &str, map: &ReportsTo) -> bool {
    leads_of(agent, map).is_some_and(|chain| chain.len() < MAX_ORG_DEPTH)
}

/// A change from the window, checked. `lead` `None`: the agent reports to ARK. Returns the new map, or the refusal
/// in plain words.
pub fn check_reports_to(agent: &str, lead: Option<&str>, current: &ReportsTo, agent_ids: &[String]) -> Result<ReportsTo, String> {
    let known = |id: &str| agent_ids.iter().any(|a| a == id);
    if !known(agent) {
        return Err("That agent is not on your team.".into());
    }
    let mut next: ReportsTo = current.iter().filter(|(id, _)| *id != agent).map(|(k, v)| (k.clone(), v.clone())).collect();
    let Some(lead) = lead else { return Ok(next) };
    if !known(lead) {
        return Err("The lead is not on your team.".into());
    }
    if lead == agent {
        return Err("An agent cannot lead itself.".into());
    }
    next.insert(agent.into(), lead.into());
    if leads_of(agent, &next).is_none() {
        return Err(format!("{lead} already works under {agent}, so {agent} cannot report to {lead}."));
    }
    if !next.keys().all(|id| fits(id, &next)) {
        return Err(format!("The team can be at most {MAX_ORG_DEPTH} levels below ARK."));
    }
    Ok(next)
}

/// The chart as it stands: a gone agent's entry is dropped; a report whose lead is gone moves up to that lead's own
/// lead (or ARK). Entries in a loop or too deep are dropped.
pub fn resolve_org(raw: &ReportsTo, agent_ids: &[String]) -> ReportsTo {
    let ids: std::collections::HashSet<&str> = agent_ids.iter().map(String::as_str).collect();
    let mut moved = ReportsTo::new();
    for (agent, first) in raw {
        if !ids.contains(agent.as_str()) {
            continue;
        }
        let mut seen = vec![agent.as_str()];
        let mut lead = Some(first.as_str());
        while let Some(l) = lead.filter(|l| !ids.contains(l) && !seen.contains(l)) {
            seen.push(l);
            lead = raw.get(l).map(String::as_str);
        }
        if let Some(l) = lead.filter(|l| ids.contains(l) && *l != agent) {
            moved.insert(agent.clone(), l.into());
        }
    }
    moved.iter().filter(|(agent, _)| fits(agent, &moved)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// An agent's name from its id, or `None` for an unknown id (the id is shown then).
pub type Names<'a> = &'a dyn Fn(&str) -> Option<String>;

fn label(name: Names<'_>, id: &str) -> String {
    name(id).unwrap_or_else(|| id.to_string())
}

/// "Kame leads Lyra, Pk; Sid leads Kame", sorted; "" when no agent has a lead.
fn org_teams(map: &ReportsTo, name: Names<'_>) -> String {
    let mut teams: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (agent, lead) in map {
        teams.entry(lead).or_default().push(agent);
    }
    teams
        .iter()
        .map(|(lead, agents)| {
            let people: Vec<String> = agents.iter().map(|a| label(name, a)).collect();
            format!("{} leads {}", label(name, lead), people.join(", "))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// The main agent's team line and routing rule; "" when no agent has a lead.
pub fn org_prompt(map: &ReportsTo, name: Names<'_>) -> String {
    let teams = org_teams(map, name);
    if teams.is_empty() {
        return String::new();
    }
    format!(
        "Team: {teams}.\nGive work for an agent with a lead to that lead (or plan it with plan_work); the lead hands parts to its people. Call such an agent directly only when the user named it.\nA report that ends with \"{HAND_BACK}\" means its agent left the choice to you: pick the agent for that need and start it."
    )
}

pub fn hand_back_rule() -> String {
    format!(
        "When the work needs an agent you should not pick yourself (you are not sure who, or no agent you may call has the tools), end your turn and make the last line of your report \"{HAND_BACK} <what is needed>\". ARK then chooses the agent."
    )
}

/// The need in a report whose last non-empty line starts with "Hand back:"; `None` otherwise. One line, no control
/// characters, at most HAND_BACK_CHARS UTF-16 units.
pub fn hand_back_need(report: &str) -> Option<String> {
    let last = report.split('\n').map(js::trim).rfind(|line| !line.is_empty()).unwrap_or("");
    if !last.to_lowercase().starts_with(&HAND_BACK.to_lowercase()) {
        return None;
    }
    let rest = js::utf16_suffix(last, js::utf16_len(HAND_BACK));
    let flat = js::collapse_runs(&js::collapse_runs(&rest, js::is_control_or_format), js::is_js_space);
    let need = js::trim(&flat);
    (!need.is_empty()).then(|| js::utf16_prefix(need, HAND_BACK_CHARS))
}

/// The host's line for a handed-back report. Only `need` (hand_back_need) comes from the model.
pub fn hand_back_line(agent: &str, need: &str, map: &ReportsTo, name: Names<'_>) -> String {
    let teams = org_teams(map, name);
    let chart = if teams.is_empty() { String::new() } else { format!(" (the chart: {teams})") };
    format!("{agent} handed back to ARK: {need}. Choose the agent for it{chart}; the usual rules apply.")
}

/// Whom an agent may hand work to: its direct reports and its peers (the same lead, or both report to ARK). Sorted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Callable {
    pub reports: Vec<String>,
    pub peers: Vec<String>,
}

pub fn callable(agent: &str, map: &ReportsTo, agent_ids: &[String]) -> Callable {
    let mut ids: Vec<&String> = agent_ids.iter().collect();
    ids.sort();
    let others = || ids.iter().filter(|id| id.as_str() != agent);
    Callable {
        reports: others().filter(|id| map.get(id.as_str()).is_some_and(|l| l == agent)).map(|id| (*id).clone()).collect(),
        peers: others().filter(|id| map.get(id.as_str()) == map.get(agent)).map(|id| (*id).clone()).collect(),
    }
}

/// ADR-272: may `caller` hand a task to `target`? Only down to a direct report or across to a peer. `None`: yes;
/// else the refusal, which says what to do instead.
pub fn delegation_problem(caller: &str, target: &str, map: &ReportsTo, agent_ids: &[String], name: Names<'_>) -> Option<String> {
    if target == caller {
        return Some("You cannot give a task to yourself. Do the work, or end your turn with your report.".into());
    }
    if leads_of(caller, map).unwrap_or_default().iter().any(|l| l == target) {
        return Some(format!(
            "{} is above you in the team. Do not call up: end your turn, and your report goes back to the one who gave you the task.",
            label(name, target)
        ));
    }
    let Callable { reports, peers } = callable(caller, map, agent_ids);
    if reports.iter().chain(&peers).any(|id| id == target) {
        return None;
    }
    let can: Vec<String> = reports.iter().chain(&peers).map(|id| format!("{} ({id})", label(name, id))).collect();
    let options = if can.is_empty() { "You have no one to call.".to_string() } else { format!("You may call: {}.", can.join(", ")) };
    Some(format!(
        "{} is not one of your reports or peers. {options} Otherwise end your turn and say in your report who should do it.",
        label(name, target)
    ))
}

/// A sub-agent's team line (ADR-272); "" when it has no one to call.
pub fn team_line(agent: &str, map: &ReportsTo, agent_ids: &[String], name: Names<'_>) -> String {
    let Callable { reports, peers } = callable(agent, map, agent_ids);
    if reports.is_empty() && peers.is_empty() {
        return String::new();
    }
    let list = |ids: &[String]| ids.iter().map(|id| format!("{} ({id})", label(name, id))).collect::<Vec<_>>().join(", ");
    let mut lines = Vec::new();
    if !reports.is_empty() {
        lines.push(format!("Your reports: {}.", list(&reports)));
    }
    if !peers.is_empty() {
        lines.push(format!("Your peers: {}.", list(&peers)));
    }
    lines.push("You may give a part of your task to one of them with the Agent tool (subagent_type: its id). Its report comes back to you; use it in your own report.".into());
    lines.push("You report only by ending your turn: you have no tool to message ARK or the one who called you while you work.".into());
    lines.join("\n")
}

// ---- OrgChart.swift ----

/// The window's words: CEO, managers, agents. A "lead" is a manager.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Owner,
    Ceo,
    Lead,
    Worker,
}

impl Level {
    pub fn title(self) -> &'static str {
        match self {
            Level::Owner => "Owner",
            Level::Ceo => "CEO",
            Level::Lead => "Manager",
            Level::Worker => "Agent",
        }
    }
}

/// An agent as the window gets it: id, role and lead.
pub struct ChartMember<'a> {
    pub id: &'a str,
    pub role: &'a str,
    pub reports_to: Option<&'a str>,
}

/// The Board's team as an org chart: the owner, ARK (the CEO), then the agents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrgChart {
    /// Agent ids in the team's order.
    pub agents: Vec<String>,
    /// Each agent's lead; absent: ARK.
    pub lead_of: HashMap<String, String>,
}

impl OrgChart {
    pub const OWNER: &'static str = "@you";
    pub const ARK: &'static str = "@ark";
    pub const MAX_DEPTH: usize = 4;

    pub fn new(helpers: &[ChartMember<'_>]) -> Self {
        let team: Vec<&ChartMember<'_>> = helpers.iter().filter(|h| h.role != "improver").collect();
        let agents: Vec<String> = team.iter().map(|h| h.id.to_string()).collect();
        let mut leads: HashMap<String, String> = HashMap::new();
        for helper in &team {
            match helper.reports_to {
                Some(lead) if lead != helper.id && agents.iter().any(|a| a == lead) => {
                    leads.insert(helper.id.into(), lead.into());
                }
                _ => {}
            }
        }
        // A cycle cannot come from the runtime; if one did, its members report to ARK rather than vanish.
        for id in &agents {
            if Self::chain(id, &leads).len() > agents.len() {
                leads.remove(id);
            }
        }
        OrgChart { agents, lead_of: leads }
    }

    /// The node's parent: an agent's lead or ARK; ARK's is the owner.
    pub fn parent(&self, id: &str) -> Option<&str> {
        if id == Self::OWNER {
            return None;
        }
        if id == Self::ARK {
            return Some(Self::OWNER);
        }
        Some(self.lead_of.get(id).map_or(Self::ARK, String::as_str))
    }

    pub fn children(&self, id: &str) -> Vec<String> {
        if id == Self::OWNER {
            return vec![Self::ARK.into()];
        }
        self.agents.iter().filter(|a| self.parent(a) == Some(id)).cloned().collect()
    }

    pub fn level(&self, id: &str) -> Level {
        if id == Self::OWNER {
            Level::Owner
        } else if id == Self::ARK {
            Level::Ceo
        } else if self.children(id).is_empty() {
            Level::Worker
        } else {
            Level::Lead
        }
    }

    /// How far below ARK: 1 for ARK's direct reports.
    pub fn depth(&self, id: &str) -> usize {
        Self::chain(id, &self.lead_of).len()
    }

    /// Whether `id` sits anywhere under `ancestor`.
    pub fn is_under(&self, id: &str, ancestor: &str) -> bool {
        let mut current = self.lead_of.get(id);
        let mut steps = 0;
        while let Some(lead) = current {
            if steps > self.agents.len() {
                break;
            }
            if lead == ancestor {
                return true;
            }
            current = self.lead_of.get(lead);
            steps += 1;
        }
        false
    }

    /// Whether `agent` may report to `lead` (ARK when `None` or `@ark`): not itself, not one of its own people, and
    /// the whole branch stays within MAX_DEPTH.
    pub fn can_report(&self, agent: &str, lead: Option<&str>) -> bool {
        if !self.agents.iter().any(|a| a == agent) {
            return false;
        }
        let Some(lead) = lead.filter(|l| *l != Self::ARK) else { return true };
        if lead == agent || !self.agents.iter().any(|a| a == lead) || self.is_under(lead, agent) {
            return false;
        }
        self.depth(lead) + 1 + self.height_below(agent) <= Self::MAX_DEPTH
    }

    /// How many levels hang under an agent (0 for a worker).
    pub fn height_below(&self, id: &str) -> usize {
        self.children(id).iter().map(|c| 1 + self.height_below(c)).max().unwrap_or(0)
    }

    fn chain(id: &str, leads: &HashMap<String, String>) -> Vec<String> {
        let mut out = vec![id.to_string()];
        let mut current = leads.get(id);
        while let Some(lead) = current {
            if out.len() > leads.len() + 1 {
                break;
            }
            out.push(lead.clone());
            current = leads.get(lead);
        }
        out
    }

    /// Every node's centre on the canvas: a tidy top-down tree, each parent centred over its children, siblings `gap`
    /// apart. `node` is (width, height).
    pub fn layout(&self, node: (f64, f64), gap: f64, level_gap: f64) -> HashMap<String, (f64, f64)> {
        let mut widths: HashMap<String, f64> = HashMap::new();
        self.measure(Self::OWNER, node.0, gap, &mut widths);
        let mut points = HashMap::new();
        self.place(Self::OWNER, 0.0, 0, (node, gap, level_gap), &widths, &mut points);
        points
    }

    fn measure(&self, id: &str, node_width: f64, gap: f64, widths: &mut HashMap<String, f64>) -> f64 {
        let kids = self.children(id);
        let w = if kids.is_empty() {
            node_width
        } else {
            let sum: f64 = kids.iter().map(|k| self.measure(k, node_width, gap, widths)).sum();
            node_width.max(sum + gap * (kids.len() as f64 - 1.0))
        };
        widths.insert(id.into(), w);
        w
    }

    fn place(
        &self,
        id: &str,
        left: f64,
        row: usize,
        sizes: ((f64, f64), f64, f64),
        widths: &HashMap<String, f64>,
        points: &mut HashMap<String, (f64, f64)>,
    ) {
        let ((node_w, node_h), gap, level_gap) = sizes;
        let kids = self.children(id);
        let width_of = |k: &str| widths.get(k).copied().unwrap_or(node_w);
        let w = width_of(id);
        points.insert(id.into(), (left + w / 2.0, row as f64 * (node_h + level_gap) + node_h / 2.0));
        let span: f64 = kids.iter().map(|k| width_of(k)).sum::<f64>() + gap * kids.len().saturating_sub(1) as f64;
        let mut x = left + (w - span) / 2.0;
        for kid in &kids {
            self.place(kid, x, row + 1, sizes, widths, points);
            x += width_of(kid) + gap;
        }
    }
}
