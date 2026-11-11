//! A job's life and the job tree: the state moves, retry rule and blocker cycles of
//! `services/helpers/src/jobs.ts`; the quiet mark of `apps/mac/src/job-quiet.ts` (its rules, without the store and
//! the timer); the tree order, worker counts and marks of `apps/mac/island/Sources/ArkIslandCore/JobTree.swift`.
//! The souls and role texts of jobs.ts are not job logic and are not ported here.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use fancy_regex::Regex;
use unicode_segmentation::UnicodeSegmentation;

use crate::js;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobState {
    Queued,
    Running,
    Done,
    Failed,
    Stopped,
}

impl JobState {
    pub const ALL: [JobState; 5] = [JobState::Queued, JobState::Running, JobState::Done, JobState::Failed, JobState::Stopped];

    pub fn name(self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Running => "running",
            JobState::Done => "done",
            JobState::Failed => "failed",
            JobState::Stopped => "stopped",
        }
    }

    pub fn parse(name: &str) -> Option<JobState> {
        JobState::ALL.into_iter().find(|s| s.name() == name)
    }

    /// The states this one may become. Failed from queued: a task it waited for failed or was stopped (ADR-087).
    fn moves(self) -> &'static [JobState] {
        match self {
            JobState::Queued => &[JobState::Running, JobState::Stopped, JobState::Failed],
            JobState::Running => &[JobState::Done, JobState::Failed, JobState::Stopped],
            JobState::Done | JobState::Failed | JobState::Stopped => &[],
        }
    }

    pub fn is_final(self) -> bool {
        self.moves().is_empty()
    }

    pub fn can_move(self, to: JobState) -> bool {
        self.moves().contains(&to)
    }
}

/// The state after a move, or the refusal for a move the job's life does not allow.
pub fn move_job(from: JobState, to: JobState) -> Result<JobState, String> {
    if from.can_move(to) { Ok(to) } else { Err(format!("A {} job cannot become {}.", from.name(), to.name())) }
}

pub const MAX_AUTO_RETRIES: u32 = 1;
/// At most this many tasks one task may wait for (ADR-087).
pub const MAX_BLOCKERS: usize = 6;
/// Most tasks in one goal Pal hands the team.
pub const MAX_GOAL_TASKS: usize = 6;
/// How much of an earlier report's body a later task is given.
pub const BRIEF_REPORT_CHARS: usize = 8_000;

static RETRYABLE: LazyLock<Regex> = LazyLock::new(|| {
    js::js_regex(r"took longer than|could not run|ended without a report|in the wrong shape|took more than \d+ steps|was closed while this job ran", true)
});

/// ADR-090: a failure a second try may fix is retried once by itself.
pub fn is_retryable(error: Option<&str>) -> bool {
    error.is_some_and(|e| !e.is_empty() && RETRYABLE.is_match(&js::ascii_case_guard(e)).unwrap_or(false))
}

/// Whether making `id` wait for `blockers` would close a circle. `edges` maps each task to the tasks it waits for.
pub fn makes_cycle(edges: &HashMap<i64, Vec<i64>>, id: i64, blockers: &[i64]) -> bool {
    let mut seen = HashSet::new();
    let mut stack = blockers.to_vec();
    while let Some(next) = stack.pop() {
        if next == id {
            return true;
        }
        if !seen.insert(next) {
            continue;
        }
        stack.extend(edges.get(&next).into_iter().flatten());
    }
    false
}

// ---- job-quiet.ts ----

/// ADR-273: a running job with no move for this long is marked quiet once.
pub const QUIET_AFTER_MS: i64 = 8 * 60_000;

/// A running native job (one with a chat), as a sweep sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunningJob {
    pub id: i64,
    pub parent: Option<i64>,
}

/// One `job.quiet` log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuietEvent {
    pub job: i64,
    pub parent: Option<i64>,
}

/// The quiet marks, in memory only. The caller feeds it each move and calls `sweep` each minute.
#[derive(Debug, Default)]
pub struct QuietWatch {
    last_move: HashMap<i64, i64>,
    quiet: HashMap<i64, i64>,
}

impl QuietWatch {
    /// When a quiet job last moved (ms); `None` when it is not quiet.
    pub fn since(&self, job: i64) -> Option<i64> {
        self.quiet.get(&job).copied()
    }

    /// A step, tool call or state change of `job`: a move of it and of each job above it. `parent_of` reads the
    /// store. True when a mark was cleared (the listeners hear it).
    pub fn moved(&mut self, job: i64, parent_of: impl Fn(i64) -> Option<i64>, now: i64) -> bool {
        let mut cleared = false;
        let mut seen = HashSet::new();
        let mut id = Some(job);
        // ponytail: walks up the parents; ADR-272 caps the depth at 4, the seen set only stops a bad parent loop.
        while let Some(current) = id.filter(|i| seen.insert(*i)) {
            self.last_move.insert(current, now);
            cleared |= self.quiet.remove(&current).is_some();
            id = parent_of(current);
        }
        cleared
    }

    /// Checks every running native job now. Returns the jobs that became quiet (non-empty: the listeners hear it).
    pub fn sweep(&mut self, running: &[RunningJob], now: i64) -> Vec<QuietEvent> {
        let ids: HashSet<i64> = running.iter().map(|j| j.id).collect();
        self.last_move.retain(|id, _| ids.contains(id));
        self.quiet.retain(|id, _| ids.contains(id));
        let mut events = Vec::new();
        for job in running {
            let Some(&last) = self.last_move.get(&job.id) else {
                self.last_move.insert(job.id, now);
                continue;
            };
            if self.quiet.contains_key(&job.id) || now - last < QUIET_AFTER_MS {
                continue;
            }
            self.quiet.insert(job.id, last);
            events.push(QuietEvent { job: job.id, parent: job.parent });
        }
        events
    }
}

// ---- JobTree.swift ----

/// The quiet ring's tip.
pub const QUIET_TIP: &str = "No new output for 8 min";
/// The deepest level drawn; ADR-272 allows 4, so this only stops a bad loop.
const MAX_TREE_DEPTH: usize = 8;

/// `items` in tree order with their depth: each child right after its parent, one step deeper, in the order given.
/// An item whose parent is not in `items` is a root. A parent loop is shown flat rather than lost.
pub fn ordered<T: Clone>(items: &[T], id: impl Fn(&T) -> i64, parent: impl Fn(&T) -> Option<i64>) -> Vec<(T, usize)> {
    let ids: HashSet<i64> = items.iter().map(&id).collect();
    let mut children: HashMap<i64, Vec<&T>> = HashMap::new();
    let mut roots: Vec<&T> = Vec::new();
    for item in items {
        match parent(item) {
            Some(p) if p != id(item) && ids.contains(&p) => children.entry(p).or_default().push(item),
            _ => roots.push(item),
        }
    }
    let mut out = Vec::new();
    let mut placed = HashSet::new();
    let mut place_all = |starts: Vec<&T>, out: &mut Vec<(T, usize)>| {
        // Depth-first, children in order: a stack of (item, depth), pushed in reverse.
        let mut stack: Vec<(&T, usize)> = starts.into_iter().rev().map(|t| (t, 0)).collect();
        while let Some((item, depth)) = stack.pop() {
            if !placed.insert(id(item)) {
                continue;
            }
            out.push((item.clone(), depth));
            if depth < MAX_TREE_DEPTH {
                for child in children.get(&id(item)).into_iter().flatten().rev() {
                    stack.push((child, depth + 1));
                }
            }
        }
    };
    for root in roots {
        place_all(vec![root], &mut out);
    }
    for item in items {
        place_all(vec![item], &mut out);
    }
    out
}

/// How many jobs each job started directly. `parents` holds each job's parent.
pub fn worker_counts(parents: impl IntoIterator<Item = Option<i64>>) -> HashMap<i64, usize> {
    let mut counts = HashMap::new();
    for p in parents.into_iter().flatten() {
        *counts.entry(p).or_insert(0) += 1;
    }
    counts
}

/// "1 worker", "3 workers".
pub fn workers_text(n: usize) -> String {
    if n == 1 { "1 worker".into() } else { format!("{n} workers") }
}

/// One line of at most `max` characters (grapheme clusters): line breaks and runs of spaces become one space, and a
/// cut ends in "…".
pub fn line(text: Option<&str>, max: usize) -> Option<String> {
    let flat = text?.split(char::is_whitespace).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return None;
    }
    let graphemes: Vec<&str> = flat.graphemes(true).collect();
    if graphemes.len() <= max {
        return Some(flat);
    }
    let head = graphemes[..max.saturating_sub(1)].concat();
    Some(format!("{}…", head.trim_matches(|c: char| c == ' ' || c == '\t')))
}

/// The glyph a worker row shows (ADR-273).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerMark {
    Running,
    NeedsYou,
    Queued,
    Done,
    Failed,
    Stopped,
}

impl WorkerMark {
    /// A plan to approve or a held task needs the owner before any state does.
    pub fn of(state: JobState, awaits_approval: bool, held: bool) -> WorkerMark {
        if awaits_approval || held {
            return WorkerMark::NeedsYou;
        }
        match state {
            JobState::Running => WorkerMark::Running,
            JobState::Queued => WorkerMark::Queued,
            JobState::Done => WorkerMark::Done,
            JobState::Failed => WorkerMark::Failed,
            JobState::Stopped => WorkerMark::Stopped,
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            WorkerMark::Running => "Running",
            WorkerMark::NeedsYou => "Needs you",
            WorkerMark::Queued => "Queued",
            WorkerMark::Done => "Done",
            WorkerMark::Failed => "Failed",
            WorkerMark::Stopped => "Stopped",
        }
    }
}

/// The Workers card's rows past its limit: the first FOLD_LIMIT while folded, all when open. Returns the rows and
/// how many are hidden.
pub const FOLD_LIMIT: usize = 5;

pub fn fold<T>(rows: &[T], show_all: bool) -> (&[T], usize) {
    if show_all || rows.len() <= FOLD_LIMIT { (rows, 0) } else { (&rows[..FOLD_LIMIT], rows.len() - FOLD_LIMIT) }
}
