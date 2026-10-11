import CoreGraphics

/// A place on screen the model wants to show the user (ADR-054, Task 0.6.4). Positions are the ones Cua Driver
/// reports: points, origin at the top-left of the main display, y down, spanning all displays.
public struct PointTarget: Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    /// What the bubble says, e.g. "the settings button". May be empty.
    public var label: String

    public init(x: Double, y: Double, w: Double, h: Double, label: String) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.label = label
    }
}

/// One display, in AppKit coordinates: origin at the main display's bottom-left, y up.
public struct ScreenArea: Sendable, Equatable {
    public var frame: CGRect
    /// The part not covered by the menu bar and Dock.
    public var visible: CGRect

    public init(frame: CGRect, visible: CGRect) {
        self.frame = frame
        self.visible = visible
    }
}

/// Where Pal stands to point, and which side of Pal its bubble goes.
public struct PointFlight: Sendable, Equatable {
    public var feet: CGPoint
    public var bubbleSide: BubblePlacement.Side

    public init(feet: CGPoint, bubbleSide: BubblePlacement.Side) {
        self.feet = feet
        self.bubbleSide = bubbleSide
    }
}

public enum PointPlacement {
    /// Pal stands on the element's top edge with its bubble above; if that does not fit, hangs under the element
    /// with the bubble below; for an element too big for either (a whole window), stands inside its top.
    /// Returns nil when the place is nonsense or on no display, so Pal never flies off into nowhere.
    public static func flight(to target: PointTarget, screens: [ScreenArea],
                              palHeight: CGFloat, palHalfWidth: CGFloat,
                              bubbleHeight: CGFloat = BubbleLayout.size.height,
                              gap: CGFloat = 6, margin: CGFloat = 8) -> PointFlight? {
        guard let primary = screens.first else { return nil }
        guard [target.x, target.y, target.w, target.h].allSatisfy(\.isFinite), target.w >= 1, target.h >= 1 else { return nil }
        // The driver measures down from the top of the main display; AppKit measures up from its bottom.
        let top = primary.frame.maxY
        let element = CGRect(x: target.x, y: top - target.y - target.h, width: target.w, height: target.h)
        let centre = CGPoint(x: element.midX, y: element.midY)
        guard let area = screens.first(where: { $0.frame.contains(centre) }) else { return nil }
        let visible = area.visible

        let low = visible.minX + palHalfWidth + margin
        let high = visible.maxX - palHalfWidth - margin
        let x = high >= low ? min(max(element.midX, low), high) : element.midX

        let tailGap: CGFloat = 4 // between Pal and its bubble
        // Above: Pal stands on the top edge.
        let aboveY = element.maxY + 2
        if aboveY + palHeight + tailGap + bubbleHeight <= visible.maxY - margin {
            return PointFlight(feet: CGPoint(x: x, y: aboveY), bubbleSide: .above)
        }
        // Below: Pal hangs under the bottom edge, its bubble under it.
        let belowY = element.minY - gap - palHeight
        if belowY - tailGap - bubbleHeight >= visible.minY + margin {
            return PointFlight(feet: CGPoint(x: x, y: belowY), bubbleSide: .below)
        }
        // Too big for either: inside its top, kept on the display.
        let insideY = min(max(element.maxY - palHeight - gap, visible.minY + margin), visible.maxY - margin - palHeight)
        let side: BubblePlacement.Side = insideY + palHeight + tailGap + bubbleHeight <= visible.maxY - margin ? .above : .below
        return PointFlight(feet: CGPoint(x: x, y: insideY), bubbleSide: side)
    }
}
