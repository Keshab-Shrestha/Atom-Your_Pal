import CoreGraphics

/// Wisp tucking itself away (ADR-051): after a while with nothing to do it slides to a side edge of its
/// display, turned so only its head sticks out, like peeking round a corner. Pure, so every rule is
/// unit-tested without a screen.
/// AppKit coordinates: origin at the bottom left, y grows upward.

public enum PeekEdge: Sendable, Equatable {
    case left, right
}

/// Where Wisp is hiding: which edge, of which display.
public struct Peek: Sendable, Equatable {
    public var edge: PeekEdge
    public var display: CGRect

    public init(edge: PeekEdge, display: CGRect) {
        self.edge = edge
        self.display = display
    }
}

public enum PeekLayout {
    /// How far Wisp's feet are inside the display edge while hiding. The body is wider than this, so the edge
    /// still cuts it off and the head, both eyes and a hand show; 6 pt puts the head about 35% further out than
    /// the first version (feet 4 pt past the edge), which was too short (ADR-053).
    public static let inset: CGFloat = 6
    /// How much further the head slides out while the pointer is over it: a nudge, not a retreat from hiding.
    /// The body already touches the edge, so every point of nudge opens a gap of that size between Wisp and the
    /// hand that holds the edge. 4 pt is a visible nudge that still looks attached; 9 pt looked detached.
    public static let revealExtra: CGFloat = 4

    /// The edge to hide at: the nearer of the display's two side edges, skipping an edge that touches another
    /// display at Wisp's height (the body would show up on that display). Nil when neither edge is free:
    /// Wisp then stays where it is.
    public static func choose(feet: CGPoint, displays: [CGRect]) -> Peek? {
        guard let display = displays.first(where: { $0.insetBy(dx: -1, dy: -1).contains(feet) }) else { return nil }
        let others = displays.filter { $0 != display }
        func isFree(_ probe: CGPoint) -> Bool { !others.contains { $0.contains(probe) } }
        let leftFree = isFree(CGPoint(x: display.minX - 2, y: feet.y))
        let rightFree = isFree(CGPoint(x: display.maxX + 2, y: feet.y))
        let toLeft = feet.x - display.minX
        let toRight = display.maxX - feet.x
        switch (leftFree, rightFree) {
        case (true, true): return Peek(edge: toLeft <= toRight ? .left : .right, display: display)
        case (true, false): return Peek(edge: .left, display: display)
        case (false, true): return Peek(edge: .right, display: display)
        case (false, false): return nil
        }
    }

    /// Where Wisp's feet go to hide, at the height it was at. `revealed` slides the head further out.
    public static func feet(for peek: Peek, y: CGFloat, revealed: Bool = false, scale: CGFloat = 1) -> CGPoint {
        let depth = (inset + (revealed ? revealExtra : 0)) * scale
        let x = peek.edge == .left ? peek.display.minX + depth : peek.display.maxX - depth
        return CGPoint(x: x, y: y)
    }

    /// How far Wisp leans while hiding, in degrees clockwise (negative: anticlockwise): the head tips toward the display.
    public static func rotation(for peek: Peek, lean: WispLean = .normal) -> Double {
        peek.edge == .left ? lean.degrees : -lean.degrees
    }

    /// 0 standing, ±1 fully hiding: how far into the hiding pose Wisp is, from how far it has leaned so far.
    /// Positive at the left edge (looking right, into the display), negative at the right edge.
    public static func amount(rotation: Double) -> Double {
        max(-1, min(1, rotation / 30))
    }
}

/// How long Wisp may sit idle before it tucks itself away (Settings → Extras).
public enum WispHideTimeout: Int, CaseIterable, Sendable, Identifiable {
    case never = 0
    case seconds15 = 15
    case seconds30 = 30
    case minute1 = 60
    case minutes5 = 300

    public var id: Int { rawValue }
    public var seconds: Double { Double(rawValue) }

    public var title: String {
        switch self {
        case .never: "Never"
        case .seconds15: "15 s"
        case .seconds30: "30 s"
        case .minute1: "1 min"
        case .minutes5: "5 min"
        }
    }
}

/// When Wisp is due to tuck away: `timeout` seconds after the last time something woke it.
public struct PetRetreat: Sendable, Equatable {
    /// Seconds of idleness before Wisp hides. 0 = never.
    public var timeout: Double
    private var lastWake: Double

    public init(timeout: Double, now: Double) {
        self.timeout = timeout
        lastWake = now
    }

    /// Something happened: a click, a hover, a shortcut, a change in ZENO's state.
    public mutating func wake(at now: Double) {
        lastWake = now
    }

    /// `blocked` is true while Wisp is busy (being dragged, reacting, or holding the open panel).
    public func isDue(at now: Double, blocked: Bool) -> Bool {
        timeout > 0 && !blocked && now - lastWake >= timeout
    }
}

/// What a press on Wisp does (ADR-051): it opens the features panel; pressing it again closes it.
public enum PetClickAction: Sendable, Equatable {
    case open, close, none

    /// A double-click always ends with the panel open, so its second press never closes what the first opened.
    public static func forPress(clickCount: Int, panelOpen: Bool) -> PetClickAction {
        if !panelOpen { return .open }
        return clickCount >= 2 ? .none : .close
    }
}
