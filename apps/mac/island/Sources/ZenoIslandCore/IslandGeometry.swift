import CoreGraphics

/// Sizes for the status card under the menu-bar icon (ADR-038, ADR-056). Points, not pixels.
public struct IslandMetrics: Sendable, Equatable {
    /// The status card shown under the menu-bar icon during a turn when Pal is off.
    public var compact = CGSize(width: 232, height: 52)
    /// The same card, wider, while dictating with the live preview: room for the words being heard.
    public var wide = CGSize(width: 340, height: 52)
    /// Gap between the menu bar and the top of the panel.
    public var topGap: CGFloat = 6
    /// Smallest gap kept to the sides and bottom of the display.
    public var screenMargin: CGFloat = 8

    public init() {}
}

/// Where the panel sits (ADR-056): just below ZENO's menu-bar icon, centred on it like Wi-Fi or Control Centre,
/// slid sideways when that would cross the display's edge. AppKit coordinates: origin at the bottom left, y up.
public struct MenuPanelLayout: Sendable, Equatable {
    public enum Presentation: Sendable, Equatable {
        case compact, wide
    }

    /// The full frame of the display the icon is on.
    public let screen: CGRect
    /// The bottom of the menu bar (`NSScreen.visibleFrame.maxY`), or `screen.maxY` when it hides itself.
    public let menuBarBottom: CGFloat
    /// The icon's centre, left to right. Nil when its place is not known (hidden behind the notch, or no room in
    /// the menu bar): the panel goes to the top-right, where status items live.
    public let iconMidX: CGFloat?
    public let metrics: IslandMetrics

    public init(screen: CGRect, menuBarBottom: CGFloat? = nil, iconMidX: CGFloat? = nil, metrics: IslandMetrics = IslandMetrics()) {
        self.screen = screen
        self.menuBarBottom = min(screen.maxY, max(screen.minY, menuBarBottom ?? screen.maxY))
        self.iconMidX = iconMidX.flatMap { $0.isFinite ? $0 : nil }
        self.metrics = metrics
    }

    public func size(_ presentation: Presentation) -> CGSize {
        let base: CGSize
        switch presentation {
        case .compact: base = metrics.compact
        case .wide: base = metrics.wide
        }
        let room = CGSize(width: screen.width - 2 * metrics.screenMargin,
                          height: menuBarBottom - metrics.topGap - screen.minY - metrics.screenMargin)
        return CGSize(width: max(0, min(base.width, room.width)), height: max(0, min(base.height, room.height)))
    }

    /// The panel's frame: its top a small gap below the menu bar, centred under the icon, inside the display.
    public func frame(_ presentation: Presentation) -> CGRect {
        let size = size(presentation)
        let left = screen.minX + metrics.screenMargin
        let right = screen.maxX - metrics.screenMargin - size.width
        let centre = iconMidX ?? (screen.maxX - metrics.screenMargin - size.width / 2)
        let x = right >= left ? min(max(centre - size.width / 2, left), right) : left
        let top = menuBarBottom - metrics.topGap
        return CGRect(x: x, y: top - size.height, width: size.width, height: size.height)
    }

    /// Where the panel grows from as it opens (ADR-084), as a fraction of its width from the left: under the
    /// menu-bar icon, so it seems to come out of it; the top-trailing corner when the icon's place is not known.
    public func openAnchorX(_ presentation: Presentation) -> Double {
        let frame = frame(presentation)
        guard let iconMidX, frame.width > 0 else { return 1 }
        return Double(min(max((iconMidX - frame.minX) / frame.width, 0), 1))
    }
}
