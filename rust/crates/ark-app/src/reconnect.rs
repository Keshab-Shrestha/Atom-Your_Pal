//! Restarting the runtime child after it ends: waits 1, 2, 4, ... seconds, at most 30. A good start resets the count.

use std::time::Duration;

const MAX_SECONDS: u64 = 30;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    attempts: u32,
}

impl Backoff {
    /// The wait before the next start, then counts the attempt.
    pub fn next_delay(&mut self) -> Duration {
        let seconds = 1u64.checked_shl(self.attempts).unwrap_or(MAX_SECONDS).min(MAX_SECONDS);
        self.attempts = self.attempts.saturating_add(1);
        Duration::from_secs(seconds)
    }

    pub fn reset(&mut self) {
        self.attempts = 0;
    }

    pub fn attempts(&self) -> u32 {
        self.attempts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_double_up_to_thirty_seconds_and_reset_starts_over() {
        let mut b = Backoff::default();
        let waits: Vec<u64> = (0..8).map(|_| b.next_delay().as_secs()).collect();
        assert_eq!(waits, [1, 2, 4, 8, 16, 30, 30, 30]);
        b.reset();
        assert_eq!(b.next_delay().as_secs(), 1);
    }
}
