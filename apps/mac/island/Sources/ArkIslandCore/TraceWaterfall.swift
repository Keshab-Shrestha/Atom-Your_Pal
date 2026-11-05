import Foundation

/// A task's tool calls as a waterfall (2026-11-05, after the look of affectUI's Trace Waterfall; ARK's own data and code): one bar per
/// call on a shared time axis, grouped by the sub-agent that made it, the slowest call marked, and the totals above. Built from the
/// thread's recorded calls only (start time and duration); a call still running grows to "now". Pure.
public struct TraceWaterfall: Sendable, Equatable {
    public struct Row: Sendable, Equatable, Identifiable {
        public enum Kind: Sendable, Equatable { case group(String), call(HelperToolCall) }
        public var id: String
        public var kind: Kind
        /// Seconds from the first call's start.
        public var start: Double
        public var length: Double
        public var running: Bool
        public var failed: Bool
        public var indented: Bool
    }

    public var rows: [Row]
    /// Seconds from the first start to the last end.
    public var duration: Double
    public var calls: Int
    public var errors: Int
    public var subAgents: Int
    /// The longest finished call (only when there are at least two calls).
    public var slowest: String?
    public var running: Bool

    public init(calls list: [HelperToolCall], now: Date = Date()) {
        // Stable for calls at the same instant: the recorded order breaks ties.
        let sorted = list.enumerated().sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }.map(\.element)
        guard let t0 = sorted.first?.at else {
            rows = []; duration = 0; calls = 0; errors = 0; subAgents = 0; slowest = nil; running = false
            return
        }
        func span(_ c: HelperToolCall) -> (start: Double, length: Double) {
            let start = c.at.timeIntervalSince(t0)
            let length = c.durationMs.map { Double($0) / 1000 } ?? (c.state == .started ? max(0, now.timeIntervalSince(c.at)) : 0)
            return (start, max(0, length))
        }
        var out: [Row] = []
        // The main agent's calls first, in time order; then each sub-agent as a group, in the order it first appears.
        for c in sorted where c.agent == nil {
            let s = span(c)
            out.append(Row(id: c.id, kind: .call(c), start: s.start, length: s.length, running: c.state == .started, failed: c.state == .error, indented: false))
        }
        var agents: [String] = []
        for c in sorted { if let a = c.agent, !agents.contains(a) { agents.append(a) } }
        for agent in agents {
            let mine = sorted.filter { $0.agent == agent }
            let spans = mine.map(span)
            let start = spans.map(\.start).min() ?? 0
            let end = spans.map { $0.start + $0.length }.max() ?? start
            out.append(Row(id: "group:" + agent, kind: .group(agent), start: start, length: end - start,
                           running: mine.contains { $0.state == .started }, failed: mine.contains { $0.state == .error }, indented: false))
            for (c, s) in zip(mine, spans) {
                out.append(Row(id: c.id, kind: .call(c), start: s.start, length: s.length, running: c.state == .started, failed: c.state == .error, indented: true))
            }
        }
        rows = out
        let callRows = out.filter { if case .call = $0.kind { true } else { false } }
        duration = callRows.map { $0.start + $0.length }.max() ?? 0
        calls = sorted.count
        errors = sorted.filter { $0.state == .error }.count
        subAgents = agents.count
        let finished = callRows.filter { !$0.running && $0.length > 0 }
        slowest = finished.count >= 2 ? finished.max { $0.length < $1.length }?.id : nil
        running = sorted.contains { $0.state == .started }
    }

    /// Tick marks for the axis: a round step (1, 2, 5, 10, 15, 30 s, then minutes) giving about `target` ticks across `duration`.
    public static func ticks(duration: Double, target: Int = 4) -> [Double] {
        let steps: [Double] = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
        let span = max(duration, 1)
        let step = steps.first { span / $0 <= Double(target) } ?? 3600
        return stride(from: 0, through: span, by: step).map { $0 }
    }
}
