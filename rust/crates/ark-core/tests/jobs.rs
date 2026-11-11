//! The job-life cases of services/helpers/src/{helpers,tasks,issues}.test.ts, the cases of
//! apps/mac/src/job-quiet.test.ts (on the watch alone, without the store) and the cases of
//! apps/mac/island/Tests/ArkIslandCoreTests/JobTreeTests.swift that need no protocol model, one for one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use ark_core::jobs::*;

#[test]
fn a_job_moves_queued_running_final_and_final_states_never_move() {
    let allowed = ["queued>running", "queued>stopped", "queued>failed", "running>done", "running>failed", "running>stopped"];
    for from in JobState::ALL {
        for to in JobState::ALL {
            let ok = allowed.contains(&format!("{}>{}", from.name(), to.name()).as_str());
            assert_eq!(from.can_move(to), ok, "{} → {}", from.name(), to.name());
            if ok {
                assert_eq!(move_job(from, to), Ok(to));
            } else {
                assert!(move_job(from, to).is_err());
            }
        }
    }
}

#[test]
fn cycles_are_found_through_any_path() {
    let edges: HashMap<i64, Vec<i64>> = HashMap::from([(2, vec![1]), (3, vec![2]), (4, vec![])]);
    assert!(makes_cycle(&edges, 1, &[3]));
    assert!(!makes_cycle(&edges, 1, &[4]));
    assert!(!makes_cycle(&edges, 5, &[3, 4]));
}

#[test]
fn retryable_failures_and_setup_problems() {
    assert!(is_retryable(Some("Claude Code ended without a report.")) && is_retryable(Some("The report came back in the wrong shape (body).")));
    assert!(is_retryable(Some("Took longer than 15 minutes")));
    for error in ["Sid needs the Claude plan for research.", "Kame needs a folder to work in: grant one in the ARK window.", "Your Claude plan limit is reached."] {
        assert!(!is_retryable(Some(error)), "{error}");
    }
}

// ---- job-quiet.test.ts: the store's parent links as a table ----

fn running(jobs: &[(i64, Option<i64>)]) -> Vec<RunningJob> {
    jobs.iter().map(|&(id, parent)| RunningJob { id, parent }).collect()
}

fn parent_in(jobs: &[(i64, Option<i64>)]) -> impl Fn(i64) -> Option<i64> + '_ {
    move |id| jobs.iter().find(|j| j.0 == id).and_then(|j| j.1)
}

#[test]
fn a_quiet_job_is_marked_once_and_its_next_step_clears_its_mark_and_its_managers() {
    let jobs = [(1, None), (2, Some(1))];
    let mut clock = 1_000_000;
    let mut watch = QuietWatch::default();
    let mut changes = 0;
    assert!(watch.sweep(&running(&jobs), clock).is_empty(), "first sight starts the count");
    clock += QUIET_AFTER_MS - 1;
    assert!(watch.sweep(&running(&jobs), clock).is_empty());
    assert_eq!(watch.since(2), None);
    clock += 1;
    let events = watch.sweep(&running(&jobs), clock);
    changes += usize::from(!events.is_empty());
    assert_eq!(watch.since(2), Some(1_000_000));
    assert_eq!(watch.since(1), Some(1_000_000));
    assert_eq!(events.len(), 2);
    assert!(events.contains(&QuietEvent { job: 2, parent: Some(1) }));
    assert_eq!(changes, 1);
    clock += QUIET_AFTER_MS;
    assert!(watch.sweep(&running(&jobs), clock).is_empty(), "still quiet: no second log, no second change");
    changes += usize::from(watch.moved(2, parent_in(&jobs), clock));
    assert_eq!(watch.since(2), None, "a worker's move is also its manager's move");
    assert_eq!(watch.since(1), None);
    assert_eq!(changes, 2);
    clock += QUIET_AFTER_MS - 1;
    watch.sweep(&running(&jobs), clock);
    assert_eq!(watch.since(2), None);
    assert_eq!(watch.since(1), None);
}

#[test]
fn a_manager_whose_workers_worker_moves_is_never_quiet_but_a_worker_is_when_only_its_manager_moves() {
    let jobs = [(1, None), (2, Some(1)), (3, Some(2))];
    let mut clock = 0;
    let mut watch = QuietWatch::default();
    watch.sweep(&running(&jobs), clock);
    for _ in 1..=20 {
        clock += 60_000;
        watch.moved(3, parent_in(&jobs), clock);
        watch.sweep(&running(&jobs), clock);
    }
    assert_eq!([1, 2, 3].map(|j| watch.since(j)), [None, None, None]);
    clock += QUIET_AFTER_MS;
    watch.moved(1, parent_in(&jobs), clock);
    watch.sweep(&running(&jobs), clock);
    assert_eq!(watch.since(1), None);
    assert!(watch.since(2).is_some());
    assert!(watch.since(3).is_some());
}

#[test]
fn a_job_that_ends_loses_its_quiet_mark() {
    let jobs = [(1, None)];
    let mut clock = 0;
    let mut watch = QuietWatch::default();
    watch.sweep(&running(&jobs), clock);
    clock += QUIET_AFTER_MS;
    watch.sweep(&running(&jobs), clock);
    assert!(watch.since(1).is_some());
    watch.sweep(&[], clock);
    assert_eq!(watch.since(1), None);
}

// ---- JobTreeTests.swift ----

#[test]
fn children_follow_their_parent_an_orphan_is_a_root_a_loop_still_shows_every_job() {
    let jobs = [(1, None), (2, None), (3, Some(1)), (4, Some(3)), (5, Some(99))];
    let tree = ordered(&jobs, |j| j.0, |j| j.1);
    assert_eq!(tree.iter().map(|(j, _)| j.0).collect::<Vec<_>>(), [1, 3, 4, 2, 5]);
    assert_eq!(tree.iter().map(|(_, d)| *d).collect::<Vec<_>>(), [0, 1, 2, 0, 0]);
    let mut looped: Vec<i64> = ordered(&[(7, Some(8)), (8, Some(7))], |j| j.0, |j| j.1).iter().map(|(j, _)| j.0).collect();
    looped.sort();
    assert_eq!(looped, [7, 8]);
}

#[test]
fn a_manager_counts_the_jobs_it_started_directly() {
    let counts = worker_counts([None, Some(1), Some(1), Some(2)]);
    assert_eq!(counts, HashMap::from([(1, 2), (2, 1)]));
    assert_eq!(workers_text(1), "1 worker");
    assert_eq!(workers_text(3), "3 workers");
}

#[test]
fn a_detail_becomes_one_line_cut_with_an_ellipsis() {
    assert_eq!(line(Some("Found\n three   flights"), 120).as_deref(), Some("Found three flights"));
    assert_eq!(line(Some(&"a".repeat(200)), 10).as_deref(), Some("aaaaaaaaa…"));
    assert_eq!(line(Some("  \n "), 120), None);
    assert_eq!(line(None, 120), None);
}

#[test]
fn the_mark_puts_a_plan_to_approve_or_a_held_task_before_the_state() {
    assert_eq!(WorkerMark::of(JobState::Queued, true, false), WorkerMark::NeedsYou);
    assert_eq!(WorkerMark::of(JobState::Failed, false, true), WorkerMark::NeedsYou);
    let marks: Vec<WorkerMark> = JobState::ALL.iter().map(|s| WorkerMark::of(*s, false, false)).collect();
    assert_eq!(marks, [WorkerMark::Queued, WorkerMark::Running, WorkerMark::Done, WorkerMark::Failed, WorkerMark::Stopped]);
}

#[test]
fn the_workers_card_folds_past_five_rows() {
    let rows: Vec<i32> = (1..=7).collect();
    assert_eq!(fold(&rows, false).0, [1, 2, 3, 4, 5]);
    assert_eq!(fold(&rows, false).1, 2);
    assert_eq!(fold(&rows, true).0, rows.as_slice());
    assert_eq!(fold(&[1, 2, 3, 4, 5], false).1, 0);
}
