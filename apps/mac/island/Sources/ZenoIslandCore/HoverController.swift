/// Decides when the island is shown, from where the pointer is and how long it has been there
/// (ADR-036, ADR-037). It holds no timers: the app calls `update` on every pointer move and again at
/// `recheckAt`, so the timing is testable with plain numbers.
public struct HoverController: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Off screen.
        case hidden
        /// The pointer is in the hover strip; the panel appears if it stays until `since + revealDelay`.
        case arming(since: Double)
        /// On screen.
        case shown
        /// The pointer has left; the panel hides at `since + hideDelay` unless it comes back.
        case leaving(since: Double)
    }

    public struct Output: Sendable, Equatable {
        public var visible: Bool
        /// When to call `update` again even if the pointer does not move (nil: only on movement).
        public var recheckAt: Double?

        public init(visible: Bool, recheckAt: Double?) {
            self.visible = visible
            self.recheckAt = recheckAt
        }
    }

    /// Seconds the pointer must rest in the hover strip before the panel appears.
    public var revealDelay: Double
    /// Seconds after the pointer leaves before the panel hides.
    public var hideDelay: Double
    public private(set) var phase: Phase = .hidden
    /// Kept visible regardless of the pointer: during a turn, or while expanded.
    /// When released, the panel hides `hideDelay` after the next update with the pointer away.
    public var held = false {
        didSet { if held { phase = .shown } }
    }
    /// Kept visible until this time regardless of the pointer (after a turn ends, or to show a problem).
    public private(set) var lingerUntil: Double?

    public init(revealDelay: Double = 0.25, hideDelay: Double = 0.5) {
        self.revealDelay = revealDelay
        self.hideDelay = hideDelay
    }

    /// Shows the panel now and keeps it shown until `time`, then hides as usual unless the pointer is near.
    public mutating func linger(until time: Double) {
        lingerUntil = max(lingerUntil ?? time, time)
        phase = .shown
    }

    /// Hides at the next update unless held or the pointer is over the panel (e.g. after a click outside).
    public mutating func dismiss() {
        lingerUntil = nil
        if phase == .shown { phase = .leaving(since: -Double.infinity) }
    }

    public var visible: Bool {
        switch phase {
        case .shown, .leaving: true
        case .hidden, .arming: false
        }
    }

    /// - Parameters:
    ///   - inTrigger: the pointer is in the hover strip at the top edge.
    ///   - inKeepZone: the pointer is over the shown panel or close to it.
    ///   - now: a monotonic clock in seconds.
    public mutating func update(inTrigger: Bool, inKeepZone: Bool, now: Double) -> Output {
        if held {
            phase = .shown
            return Output(visible: true, recheckAt: nil)
        }
        if let until = lingerUntil {
            if now < until {
                phase = .shown
                return Output(visible: true, recheckAt: until)
            }
            lingerUntil = nil // ended: continue as if shown by hover
        }
        switch phase {
        case .hidden:
            guard inTrigger else { return Output(visible: false, recheckAt: nil) }
            phase = .arming(since: now)
            return update(inTrigger: inTrigger, inKeepZone: inKeepZone, now: now)

        case .arming(let since):
            guard inTrigger else {
                phase = .hidden // passed through without resting: not a request
                return Output(visible: false, recheckAt: nil)
            }
            if now - since >= revealDelay {
                phase = .shown
                return Output(visible: true, recheckAt: nil)
            }
            return Output(visible: false, recheckAt: since + revealDelay)

        case .shown:
            if inKeepZone || inTrigger { return Output(visible: true, recheckAt: nil) }
            phase = .leaving(since: now)
            return Output(visible: true, recheckAt: now + hideDelay)

        case .leaving(let since):
            if inKeepZone || inTrigger {
                phase = .shown
                return Output(visible: true, recheckAt: nil)
            }
            if now - since >= hideDelay {
                phase = .hidden
                return Output(visible: false, recheckAt: nil)
            }
            return Output(visible: true, recheckAt: since + hideDelay)
        }
    }
}
