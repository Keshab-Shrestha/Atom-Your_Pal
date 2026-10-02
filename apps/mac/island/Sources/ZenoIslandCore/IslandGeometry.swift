import CoreGraphics

/// Sizes and distances for the island (ADR-036). Points, not pixels.
public struct IslandMetrics: Sendable, Equatable {
    /// The pill shown on hover and while talking.
    public var compact = CGSize(width: 200, height: 36)
    /// The conversation view opened by clicking the pill (Task 0.5.7).
    public var expanded = CGSize(width: 420, height: 300)
    /// Width of the hover strip at the top edge, centred on the display.
    public var triggerWidth: CGFloat = 320
    /// How close to the top edge the pointer must be (the pointer stops at the edge, so this is small).
    public var triggerDepth: CGFloat = 2
    /// How far the pointer may stray from the shown panel before it starts to hide.
    public var keepMargin: CGFloat = 28
    /// Smallest gap kept between the panel and the display's left and right edges.
    public var sideMargin: CGFloat = 8

    public init() {}
}

/// Where the island sits on a display. AppKit coordinates: origin at the bottom left, y grows upward,
/// so the top edge of a display is `frame.maxY`.
public struct IslandGeometry: Sendable, Equatable {
    public enum Presentation: Sendable, Equatable {
        case compact, expanded
    }

    /// The full frame of the display with the menu bar (not `visibleFrame`: the island covers the menu bar).
    public let screen: CGRect
    /// Space taken at the top by a camera housing (`NSScreen.safeAreaInsets.top`); 0 without a notch.
    /// The panel grows by this much so its content sits below the notch.
    public let topInset: CGFloat
    public let metrics: IslandMetrics

    public init(screen: CGRect, topInset: CGFloat = 0, metrics: IslandMetrics = IslandMetrics()) {
        self.screen = screen
        self.topInset = max(0, topInset)
        self.metrics = metrics
    }

    public func size(_ presentation: Presentation) -> CGSize {
        let base = presentation == .compact ? metrics.compact : metrics.expanded
        let width = min(base.width, max(0, screen.width - 2 * metrics.sideMargin))
        return CGSize(width: width, height: base.height + topInset)
    }

    /// The panel's frame. Hidden: directly above the top edge, entirely off the display. Shown: hanging
    /// from the top edge. Both are centred, so sliding between them is a straight vertical move.
    public func frame(_ presentation: Presentation, visible: Bool) -> CGRect {
        let size = size(presentation)
        let x = (screen.midX - size.width / 2).rounded()
        let y = visible ? screen.maxY - size.height : screen.maxY
        return CGRect(x: x, y: y, width: size.width, height: size.height)
    }

    /// The hover strip: the pointer pressed against the top edge, near the centre.
    public func inTrigger(_ point: CGPoint) -> Bool {
        abs(point.x - screen.midX) <= metrics.triggerWidth / 2
            && point.y >= screen.maxY - metrics.triggerDepth
            && point.y <= screen.maxY + 1
    }

    /// While the panel is shown, the pointer keeps it open anywhere over it, a margin around it, or
    /// the hover strip.
    public func inKeepZone(_ point: CGPoint, _ presentation: Presentation) -> Bool {
        let zone = frame(presentation, visible: true).insetBy(dx: -metrics.keepMargin, dy: -metrics.keepMargin)
        let insideZone = point.x >= zone.minX && point.x <= zone.maxX && point.y >= zone.minY && point.y <= screen.maxY + 1
        return insideZone || inTrigger(point)
    }
}
