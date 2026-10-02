import CoreGraphics

/// Sizes and distances for the island (ADR-037, ADR-038). Points, not pixels.
public struct IslandMetrics: Sendable, Equatable {
    /// The card shown on hover and while talking.
    public var compact = CGSize(width: 232, height: 52)
    /// The expanded view opened by clicking the card (Tasks 0.5.6–0.5.7).
    public var expanded = CGSize(width: 380, height: 460)
    /// Gap between the card and the left edge of the display when shown.
    public var edgeInset: CGFloat = 8
    /// Gap between the menu bar and the top of the card.
    public var topGap: CGFloat = 8
    /// The hover band: this tall, starting at the bottom of the menu bar.
    public var triggerHeight: CGFloat = 140
    /// How close to the left edge the pointer must be (it stops at the edge, so this is small).
    public var triggerDepth: CGFloat = 2
    /// How far the pointer may stray from the shown card before it starts to hide.
    public var keepMargin: CGFloat = 24
    /// Smallest gap kept to the bottom and right of the display, for small displays.
    public var screenMargin: CGFloat = 8

    public init() {}
}

/// Where the island sits on a display: at the left edge, just below the menu bar (ADR-037).
/// AppKit coordinates: origin at the bottom left, y grows upward.
public struct IslandGeometry: Sendable, Equatable {
    public enum Presentation: Sendable, Equatable {
        case compact, expanded
    }

    /// The full frame of the display with the menu bar.
    public let screen: CGRect
    /// The bottom of the menu bar (`NSScreen.visibleFrame.maxY`). Equal to `screen.maxY` when the
    /// menu bar hides itself.
    public let menuBarBottom: CGFloat
    public let metrics: IslandMetrics

    public init(screen: CGRect, menuBarBottom: CGFloat? = nil, metrics: IslandMetrics = IslandMetrics()) {
        self.screen = screen
        self.menuBarBottom = min(screen.maxY, max(screen.minY, menuBarBottom ?? screen.maxY))
        self.metrics = metrics
    }

    public func size(_ presentation: Presentation) -> CGSize {
        let base = presentation == .compact ? metrics.compact : metrics.expanded
        let room = CGSize(
            width: screen.width - metrics.edgeInset - metrics.screenMargin,
            height: menuBarBottom - metrics.topGap - screen.minY - metrics.screenMargin)
        return CGSize(width: max(0, min(base.width, room.width)), height: max(0, min(base.height, room.height)))
    }

    /// The card's top edge: a small gap below the menu bar.
    var top: CGFloat { menuBarBottom - metrics.topGap }

    /// The card's frame. Hidden: entirely past the left edge, at the same height. Shown: a small gap
    /// in from the left edge. Sliding between them is a straight horizontal move.
    public func frame(_ presentation: Presentation, visible: Bool) -> CGRect {
        let size = size(presentation)
        let x = visible ? screen.minX + metrics.edgeInset : screen.minX - size.width
        return CGRect(x: x, y: top - size.height, width: size.width, height: size.height)
    }

    /// The hover band: the pointer pressed against the left edge, just below the menu bar.
    /// It starts below the menu bar, so the Apple menu and the top-left corner (a hot corner) never trigger it.
    public func inTrigger(_ point: CGPoint) -> Bool {
        point.x <= screen.minX + metrics.triggerDepth
            && point.x >= screen.minX - 1
            && point.y < menuBarBottom
            && point.y >= menuBarBottom - metrics.triggerHeight
    }

    /// While the card is shown, the pointer keeps it open anywhere over it, a margin around it, or the
    /// strip between it and the left edge. The menu bar above it is not included.
    public func inKeepZone(_ point: CGPoint, _ presentation: Presentation) -> Bool {
        let card = frame(presentation, visible: true)
        let inZone = point.x >= screen.minX - 1
            && point.x <= card.maxX + metrics.keepMargin
            && point.y >= card.minY - metrics.keepMargin
            && point.y < menuBarBottom
        return inZone || inTrigger(point)
    }
}
