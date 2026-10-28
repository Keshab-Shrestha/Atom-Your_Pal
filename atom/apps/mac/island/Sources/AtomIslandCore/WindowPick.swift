import CoreGraphics

/// One on-screen window, from `CGWindowListCopyWindowInfo` (ADR-074). Never its title: that would need Screen Recording.
public struct WindowInfo: Sendable, Equatable {
    public var pid: Int32
    /// 0 for ordinary app windows; menus, the Dock, overlays sit higher.
    public var layer: Int
    /// In AppKit screen coordinates (origin bottom-left of the primary display).
    public var bounds: CGRect
    public var isOnScreen: Bool

    public init(pid: Int32, layer: Int, bounds: CGRect, isOnScreen: Bool) {
        self.pid = pid
        self.layer = layer
        self.bounds = bounds
        self.isOnScreen = isOnScreen
    }
}

public enum WindowPick {
    /// The frontmost ordinary window under `point`, skipping ATOM's own. `windows` is front to back, as the window list returns it.
    public static func window(at point: CGPoint, in windows: [WindowInfo], ownPID: Int32) -> WindowInfo? {
        windows.first { $0.isOnScreen && $0.layer == 0 && $0.pid != ownPID && $0.bounds.contains(point) }
    }

    /// Window-list bounds (origin top-left of the primary display, y down) to AppKit's (origin bottom-left, y up).
    public static func appKitRect(_ rect: CGRect, primaryHeight: CGFloat) -> CGRect {
        CGRect(x: rect.minX, y: primaryHeight - rect.maxY, width: rect.width, height: rect.height)
    }
}

/// What a drop of Pal does: Option held over a window asks about it; anything else parks Pal as before (ADR-043).
public enum PetDrop: Sendable, Equatable {
    case park
    case ask(WindowInfo)

    public static func decide(optionHeld: Bool, window: WindowInfo?) -> PetDrop {
        guard optionHeld, let window else { return .park }
        return .ask(window)
    }
}

extension PetBrain {
    /// Puts Pal down where it was picked up, after it was dropped on a window to ask (ADR-074): a parked Pal stays
    /// parked, a walking one keeps its place on the walkway.
    public mutating func putBack(at now: Double) {
        drop(homeX: pinned ? nil : x, at: now)
    }
}
