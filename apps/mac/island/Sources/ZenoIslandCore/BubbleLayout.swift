import CoreGraphics

/// Where Pal's speech bubble goes (ADR-050): above Pal, centred on it, kept on the display.
/// Near the top of the display it drops below Pal instead. The bubble's tail always points at Pal,
/// even when the bubble itself had to slide sideways to stay on screen.
/// AppKit coordinates: origin at the bottom left, y grows upward.
public struct BubblePlacement: Sendable, Equatable {
    public enum Side: Sendable, Equatable {
        /// The bubble sits above Pal; its tail is on the bottom edge.
        case above
        /// The bubble sits below Pal; its tail is on the top edge.
        case below
    }

    /// The bubble including its tail.
    public var frame: CGRect
    public var side: Side
    /// Where the tail's tip is, measured from the bubble's left edge.
    public var tailX: CGFloat

    public init(frame: CGRect, side: Side, tailX: CGFloat) {
        self.frame = frame
        self.side = side
        self.tailX = tailX
    }
}

public enum BubbleLayout {
    /// The bubble with its tail: the body is `size.height - tailHeight` tall.
    public static let size = CGSize(width: 340, height: 60)
    public static let tailHeight: CGFloat = 8
    /// Lantern's bubble radius (ADR-084, design study §3 A).
    public static let cornerRadius: CGFloat = 18
    /// The tail stays this far from the bubble's ends, clear of the rounded corners: the corner radius plus the
    /// tail's half-width plus a little.
    public static let tailInset: CGFloat = 28

    /// - Parameters:
    ///   - feet: the point on the ground under Pal.
    ///   - bodyHeight: how tall Pal stands above `feet`.
    ///   - bounds: the area the bubble must stay inside (the display, below the menu bar).
    ///   - prefer: the side to use if it fits; otherwise the usual choice.
    public static func place(feet: CGPoint, bodyHeight: CGFloat = 54, gap: CGFloat = 4,
                             size: CGSize = BubbleLayout.size, in bounds: CGRect, margin: CGFloat = 8,
                             prefer: BubblePlacement.Side? = nil) -> BubblePlacement {
        let width = min(size.width, max(0, bounds.width - 2 * margin))
        let left = bounds.minX + margin
        let right = bounds.maxX - margin - width
        let x = right >= left ? min(max(feet.x - width / 2, left), right) : left

        let aboveY = feet.y + bodyHeight + gap
        let belowY = feet.y - gap - size.height
        let aboveFits = aboveY + size.height <= bounds.maxY - margin
        let belowFits = belowY >= bounds.minY + margin
        let side: BubblePlacement.Side
        let y: CGFloat
        // A preferred side wins when it fits (pointing: the bubble must not cover what Pal points at).
        let useAbove = prefer == .above && aboveFits ? true : prefer == .below && belowFits ? false : (aboveFits || !belowFits)
        if useAbove {
            side = .above
            y = min(aboveY, bounds.maxY - margin - size.height)
        } else {
            side = .below
            y = belowY
        }
        let tailX = min(max(feet.x - x, tailInset), max(tailInset, width - tailInset))
        return BubblePlacement(frame: CGRect(x: x, y: y, width: width, height: size.height), side: side, tailX: tailX)
    }
}
