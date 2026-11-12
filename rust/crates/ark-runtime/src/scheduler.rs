//! A small ticker (Phase 2 step 1). `Scheduler` keeps named jobs with a period; `due(now)` says which ones are
//! due and moves their next time forward. The clock is an argument, so tests need no sleep. `spawn` runs it on a thread.
//! A job that was late runs once, not once per missed period.

use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Default)]
pub struct Scheduler {
    jobs: Vec<Job>,
}

#[derive(Debug)]
struct Job {
    name: String,
    period: Duration,
    next: Duration,
}

impl Scheduler {
    /// Adds a job whose first run is one period after `now`. Adding a name again replaces the job.
    pub fn add(&mut self, name: &str, period: Duration, now: Duration) {
        self.remove(name);
        self.jobs.push(Job { name: name.to_string(), period: period.max(Duration::from_millis(1)), next: now + period });
    }

    pub fn remove(&mut self, name: &str) {
        self.jobs.retain(|j| j.name != name);
    }

    /// The names of the jobs due at `now`, in the order they were added.
    pub fn due(&mut self, now: Duration) -> Vec<String> {
        let mut out = Vec::new();
        for job in self.jobs.iter_mut().filter(|j| j.next <= now) {
            let late = (now - job.next).as_nanos() / job.period.as_nanos();
            job.next += job.period * (late as u32 + 1);
            out.push(job.name.clone());
        }
        out
    }

    /// How long until the next job is due (None without jobs).
    pub fn wait(&self, now: Duration) -> Option<Duration> {
        self.jobs.iter().map(|j| j.next.saturating_sub(now)).min()
    }
}

/// A running ticker. `stop` ends the thread.
pub struct Ticker {
    stop: Sender<()>,
    handle: JoinHandle<()>,
}

impl Ticker {
    /// Runs `scheduler` on a thread; `fire(name)` is called for each due job.
    pub fn spawn(mut scheduler: Scheduler, fire: impl Fn(&str) + Send + 'static) -> Ticker {
        let (stop, rx) = mpsc::channel::<()>();
        let start = Instant::now();
        let handle = thread::spawn(move || {
            loop {
                let wait = scheduler.wait(start.elapsed()).unwrap_or(Duration::from_secs(60));
                match rx.recv_timeout(wait) {
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    _ => return,
                }
                for name in scheduler.due(start.elapsed()) {
                    fire(&name);
                }
            }
        });
        Ticker { stop, handle }
    }

    pub fn stop(self) {
        self.stop.send(()).ok();
        self.handle.join().ok();
    }
}

/// Counts the runs of each job over `ticks` steps of `step`; for tests and for planning.
pub fn simulate(scheduler: &mut Scheduler, step: Duration, ticks: u32) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for i in 1..=ticks {
        for name in scheduler.due(step * i) {
            *counts.entry(name).or_insert(0) += 1;
        }
    }
    counts
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const S: Duration = Duration::from_secs(1);

    #[test]
    fn jobs_run_each_period_and_a_late_job_runs_once() {
        let mut s = Scheduler::default();
        s.add("fast", 2 * S, Duration::ZERO);
        s.add("slow", 5 * S, Duration::ZERO);
        assert_eq!(s.due(S), Vec::<String>::new());
        assert_eq!(s.due(2 * S), vec!["fast"]);
        assert_eq!(s.wait(2 * S), Some(2 * S));
        // 100 seconds pass at once: each job runs once, then waits for its next slot.
        assert_eq!(s.due(100 * S), vec!["fast", "slow"]);
        assert_eq!(s.due(100 * S), Vec::<String>::new());
        assert_eq!(s.wait(100 * S), Some(2 * S));
        s.remove("fast");
        assert_eq!(s.due(101 * S), Vec::<String>::new());
        assert_eq!(Scheduler::default().wait(S), None);
    }

    #[test]
    fn counts_over_a_simulated_run() {
        let mut s = Scheduler::default();
        s.add("a", 3 * S, Duration::ZERO);
        let counts = simulate(&mut s, S, 10);
        assert_eq!(counts["a"], 3);
    }

    #[test]
    fn the_ticker_fires_and_stops() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let mut s = Scheduler::default();
        s.add("beat", Duration::from_millis(10), Duration::ZERO);
        let sink = Arc::clone(&seen);
        let ticker = Ticker::spawn(s, move |name| sink.lock().unwrap().push(name.to_string()));
        let deadline = Instant::now() + Duration::from_secs(5);
        while seen.lock().unwrap().len() < 2 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        ticker.stop();
        assert!(seen.lock().unwrap().len() >= 2);
    }
}
