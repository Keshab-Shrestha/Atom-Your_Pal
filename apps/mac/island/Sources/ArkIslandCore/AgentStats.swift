import Foundation

/// One agent's record from its recent tasks (2026-11-02): how many ended, how many of those were done, and a typical time. The team list
/// keeps an agent's newest jobs, so this is "recently", not "ever".
public struct AgentStats: Sendable, Equatable {
    public let runs: Int
    /// Done as a share of the runs that ended done or failed; nil before any did.
    public let doneShare: Double?
    /// The median time of done runs, in seconds; nil before any.
    public let typicalSeconds: Double?

    public init(jobs: [HelperJob]) {
        let ended = jobs.filter { $0.state == .done || $0.state == .failed }
        runs = ended.count
        doneShare = ended.isEmpty ? nil : Double(ended.filter { $0.state == .done }.count) / Double(ended.count)
        let times = jobs.filter { $0.state == .done }.compactMap { job -> Double? in
            guard let start = job.createdAt, let end = job.endedAt, end >= start else { return nil }
            return end.timeIntervalSince(start)
        }.sorted()
        typicalSeconds = times.isEmpty ? nil : times.count % 2 == 1 ? times[times.count / 2] : (times[times.count / 2 - 1] + times[times.count / 2]) / 2
    }

    /// "12 runs · 92% done · 48s typical", or nil before the first run.
    public var line: String? {
        guard runs > 0 else { return nil }
        var parts = ["\(runs) \(runs == 1 ? "run" : "runs")"]
        if let doneShare { parts.append("\(Int((doneShare * 100).rounded()))% done") }
        if let t = typicalSeconds { parts.append(t >= 60 ? "\(Int(t / 60))m \(Int(t) % 60)s typical" : "\(Int(t.rounded()))s typical") }
        return parts.joined(separator: " · ")
    }
}
