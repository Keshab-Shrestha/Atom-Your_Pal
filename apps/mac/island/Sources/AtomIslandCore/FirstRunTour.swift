import Foundation

/// One step of the first-run tour (ADR-075).
public enum TourStep: Sendable, Equatable {
    /// Pal's hello bounce (ADR-073).
    case hello
    /// Pal's bubble says this.
    case say(title: String, detail: String)
    /// Pal flies to the menu-bar icon with this label beside it (ADR-054 pointing).
    case point(label: String)
    /// Pal flies back.
    case back
    case done
}

/// The first-run tour: runs once (`zeno.tourDone`), replayable from Settings → General, and ends at once if the user
/// talks or dictates. Pure state: the controller runs each step after its delay.
public struct FirstRunTour: Sendable, Equatable {
    public struct Beat: Sendable, Equatable {
        public var step: TourStep
        /// Seconds after the previous step.
        public var after: Double
    }

    public static let script: [Beat] = [
        Beat(step: .hello, after: 0),
        Beat(step: .say(title: "Hi, I'm ATOM.", detail: "Hold Control + Option and talk to me."), after: 1),
        Beat(step: .point(label: "Settings and our chats live here"), after: 4.5),
        Beat(step: .back, after: 5),
        Beat(step: .done, after: 1.5),
    ]

    /// On launch: only with Pal shown, once the runtime is ready, and only if it has not run before.
    public static func shouldStart(palShown: Bool, tourDone: Bool, runtimeReady: Bool) -> Bool {
        palShown && !tourDone && runtimeReady
    }

    /// The step running now; nil when the tour is not running.
    public private(set) var index: Int?

    public init() {}

    public var isRunning: Bool { index != nil }

    /// Starts from the first step and returns it.
    public mutating func start() -> TourStep {
        index = 0
        return Self.script[0].step
    }

    /// The next step, or nil once the tour is over.
    public mutating func advance() -> TourStep? {
        guard let current = index else { return nil }
        let next = current + 1
        guard next < Self.script.count else {
            index = nil
            return nil
        }
        index = next
        return Self.script[next].step
    }

    /// The user talked or dictated: the tour ends. True if it was running (the caller then sends Pal back and
    /// stores `tourDone`).
    public mutating func userTalked() -> Bool {
        defer { index = nil }
        return index != nil
    }
}
