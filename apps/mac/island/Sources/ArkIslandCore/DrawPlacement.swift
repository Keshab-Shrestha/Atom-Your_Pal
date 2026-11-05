import Foundation

// Drawing on the screen (2026-11-05). The runtime names a place in the driver's coordinates (points from the top-left of the main display).
// This works out where on which display the shape goes, in that display's own top-left coordinates, for the overlay window to draw.

public struct DrawLayout: Sendable, Equatable {
    /// The display the place is on, in AppKit coordinates.
    public var screenFrame: CGRect
    /// The place, padded, in the display's own coordinates: origin at its top-left, y down (SwiftUI).
    public var local: CGRect

    public init(screenFrame: CGRect, local: CGRect) { self.screenFrame = screenFrame; self.local = local }
}

public enum DrawPlacement {
    /// How far the shape stands off the element.
    public static let padding: CGFloat = 8

    /// Nil when the place is nonsense or on no display.
    public static func layout(for target: PointTarget, screens: [ScreenArea]) -> DrawLayout? {
        guard let primary = screens.first else { return nil }
        guard [target.x, target.y, target.w, target.h].allSatisfy(\.isFinite), target.w >= 1, target.h >= 1 else { return nil }
        let top = primary.frame.maxY
        let element = CGRect(x: target.x, y: top - target.y - target.h, width: target.w, height: target.h)
        guard let area = screens.first(where: { $0.frame.contains(CGPoint(x: element.midX, y: element.midY)) }) else { return nil }
        let padded = element.insetBy(dx: -padding, dy: -padding)
        let local = CGRect(x: padded.minX - area.frame.minX, y: area.frame.maxY - padded.maxY, width: padded.width, height: padded.height)
        return DrawLayout(screenFrame: area.frame, local: local)
    }
}
