import Foundation

/// A run of active days (2026-11-02, after the usage-page reference): consecutive days with at least one event, ending today, or yesterday
/// when today has none yet (a streak is not broken before the day is over).
public enum ActivityStreak {
    public static func days(_ events: [Date], today: Date = Date(), calendar: Calendar = .current) -> Int {
        let active = Set(events.map { calendar.startOfDay(for: $0) })
        var day = calendar.startOfDay(for: today)
        if !active.contains(day) { day = calendar.date(byAdding: .day, value: -1, to: day) ?? day }
        var count = 0
        while active.contains(day) {
            count += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }
        return count
    }
}
