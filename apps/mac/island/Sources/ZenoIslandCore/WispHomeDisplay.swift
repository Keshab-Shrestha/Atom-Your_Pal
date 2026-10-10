import CoreGraphics

/// Which display Wisp's Dock walkway is on (ADR-078). Stored in UserDefaults as `storageValue`.
public enum WispHomeDisplay: Equatable, Hashable, Sendable {
    /// The display with the menu bar (default, as before ADR-078).
    case main
    /// The display the pointer has stayed on for `WispHomeResolver.pointerDwell` seconds.
    case pointer
    /// A chosen display, by its display UUID, so it survives a restart and a rearranged layout.
    case display(uuid: String)

    private static let displayPrefix = "display:"

    /// An unknown or empty value is the main display.
    public init(storageValue: String) {
        switch storageValue {
        case "pointer": self = .pointer
        case let value where value.hasPrefix(Self.displayPrefix) && value.count > Self.displayPrefix.count:
            self = .display(uuid: String(value.dropFirst(Self.displayPrefix.count)))
        default: self = .main
        }
    }

    public var storageValue: String {
        switch self {
        case .main: "main"
        case .pointer: "pointer"
        case .display(let uuid): Self.displayPrefix + uuid
        }
    }
}

/// A connected display as the resolver sees it, in `NSScreen.screens` order. Frames in AppKit screen coordinates.
public struct HomeDisplay: Equatable, Sendable {
    public let uuid: String
    public let frame: CGRect
    public let visibleFrame: CGRect
    /// The display with the menu bar.
    public let isMain: Bool

    public init(uuid: String, frame: CGRect, visibleFrame: CGRect, isMain: Bool) {
        self.uuid = uuid
        self.frame = frame
        self.visibleFrame = visibleFrame
        self.isMain = isMain
    }
}

public struct WispHomeResolution: Equatable, Sendable {
    /// Index into the displays given.
    public let index: Int
    /// The chosen display is not connected, so the main display is used (Settings says "not connected").
    public let chosenMissing: Bool

    public init(index: Int, chosenMissing: Bool) {
        self.index = index
        self.chosenMissing = chosenMissing
    }
}

/// Picks Wisp's home display from the connected displays (ADR-078). Pure: the app feeds it `NSScreen` and the pointer.
public enum WispHomeResolver {
    /// How long the pointer must stay on another display before Wisp's home follows it, in seconds.
    public static let pointerDwell: Double = 3

    /// - Parameters:
    ///   - pointerIndex: the display the pointer is on, or nil if it is on none.
    ///   - pointerDwell: how long the pointer has been on that display, in seconds.
    ///   - currentHome: where Wisp's home is now, or nil if it has none yet (or that display is gone).
    /// - Returns: nil only when there are no displays.
    public static func resolve(_ choice: WispHomeDisplay, displays: [HomeDisplay], pointerIndex: Int?,
                               pointerDwell: Double, currentHome: Int?) -> WispHomeResolution? {
        guard !displays.isEmpty else { return nil }
        let main = displays.firstIndex(where: \.isMain) ?? 0
        switch choice {
        case .main:
            return WispHomeResolution(index: main, chosenMissing: false)
        case .display(let uuid):
            let found = displays.firstIndex { $0.uuid == uuid }
            return WispHomeResolution(index: found ?? main, chosenMissing: found == nil)
        case .pointer:
            let current = currentHome.flatMap { displays.indices.contains($0) ? $0 : nil } ?? main
            if let pointerIndex, displays.indices.contains(pointerIndex), pointerDwell >= Self.pointerDwell {
                return WispHomeResolution(index: pointerIndex, chosenMissing: false)
            }
            return WispHomeResolution(index: current, chosenMissing: false)
        }
    }
}
