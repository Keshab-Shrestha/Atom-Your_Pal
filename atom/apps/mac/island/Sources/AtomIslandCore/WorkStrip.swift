import CoreGraphics
import Foundation

/// The strip at the bottom of the main display while ATOM works on the Mac (ADR-056). Pure state: the controller
/// draws `step`, `approval` and whether it `isShown`, and calls `apply` for every event.
///
/// It appears with ATOM's first action on the Mac in a turn (a step, a point or an approval request), never for
/// ordinary talk, and stays until the turn ends plus `linger` seconds so the outcome can be read.
public struct WorkStripState: Sendable, Equatable {
    /// What ATOM is doing now, e.g. "Typing in TextEdit".
    public private(set) var step = ""
    /// Set once the turn ends: when the strip goes away (uptime seconds).
    public private(set) var hideAt: Double?
    /// The strip is up (from the first action until `hideAt`).
    public private(set) var active = false
    /// The turn ended in a problem or was stopped: the last line says so.
    public private(set) var outcome: Outcome = .working

    public enum Outcome: Sendable, Equatable {
        case working, done, stopped, failed
    }

    /// How long the strip stays after the turn ends.
    public var linger: Double

    public init(linger: Double = 2.5) {
        self.linger = linger
    }

    public func isShown(at now: Double) -> Bool {
        guard active else { return false }
        if let hideAt { return now < hideAt }
        return true
    }

    public mutating func apply(_ event: IslandEvent, now: Double) {
        switch event {
        case .computerStep(let text):
            begin()
            step = IslandStatus.short(text)
        case .computerPoint(let target):
            begin()
            step = "Pointing at \(PointingState.line(for: target))"
        case .approvalRequest(let request):
            begin()
            step = IslandStatus.short(request.summary)
        case .state(.idle), .computerEnd:
            finish(.done, now: now)
        case .state(.listening), .conversationReset:
            clear() // a new request: the old work is over and out of the way at once
        case .error(let error) where error.endsTurn:
            finish(.failed, now: now)
        default:
            break
        }
    }

    /// The user pressed Stop (or Esc): the strip says so briefly, then goes.
    public mutating func stopped(now: Double) {
        finish(.stopped, now: now)
    }

    /// The runtime stopped or restarted: nothing is in progress.
    public mutating func runtimeStopped() { clear() }

    /// The user started something else (e.g. a dictation): the last work is out of the way at once.
    public mutating func dismiss() { clear() }

    /// What the strip's line says.
    public var line: String {
        switch outcome {
        case .working: step.isEmpty ? "Working on your Mac" : step
        case .done: "Done"
        case .stopped: "Stopped"
        case .failed: "Couldn't finish"
        }
    }

    private mutating func begin() {
        active = true
        hideAt = nil
        outcome = .working
    }

    private mutating func finish(_ outcome: Outcome, now: Double) {
        guard active, hideAt == nil else { return }
        self.outcome = outcome
        hideAt = now + linger
    }

    private mutating func clear() {
        active = false
        hideAt = nil
        step = ""
        outcome = .working
    }
}

/// Where the work strip goes (ADR-056): centred at the bottom of the main display, above the Dock and above Pal's
/// walkway, so it covers neither. AppKit coordinates.
public enum WorkStripLayout {
    /// The strip alone, and with an approval request.
    public static let size = CGSize(width: 420, height: 44)
    public static let askingSize = CGSize(width: 420, height: 164)
    public static let accessSize = CGSize(width: 520, height: 340)

    /// - Parameters:
    ///   - visible: the main display's visible frame (without the menu bar and Dock).
    ///   - clearance: room kept free above the Dock for Pal walking there (0 when Pal is off).
    public static func frame(size: CGSize, visible: CGRect, clearance: CGFloat, margin: CGFloat = 8) -> CGRect {
        let width = min(size.width, max(0, visible.width - 2 * margin))
        let x = visible.midX - width / 2
        let lowest = visible.minY + margin
        let y = min(lowest + clearance, max(lowest, visible.maxY - margin - size.height))
        return CGRect(x: x, y: y, width: width, height: size.height)
    }
}

/// Where the short label goes while Pal points (ADR-056): beside Pal's head, on the side away from the display's
/// nearer edge so it is never cut off, and never over the place pointed at (Pal stands on or under it).
public enum PointLabelLayout {
    public static let height: CGFloat = 26
    public static let maxWidth: CGFloat = 220

    /// - Parameters:
    ///   - feet: where Pal stands.
    ///   - palHeight / palHalfWidth: Pal's size.
    ///   - width: the label's measured width (clamped to `maxWidth`).
    ///   - bounds: the display, below the menu bar.
    public static func frame(feet: CGPoint, palHeight: CGFloat, palHalfWidth: CGFloat, width: CGFloat,
                             in bounds: CGRect, gap: CGFloat = 6, margin: CGFloat = 8) -> CGRect {
        let w = min(max(width, height), maxWidth, max(0, bounds.width - 2 * margin))
        // Beside the head, vertically centred on its upper half.
        let y = min(max(feet.y + palHeight * 0.55 - height / 2, bounds.minY + margin), bounds.maxY - margin - height)
        let rightX = feet.x + palHalfWidth + gap
        let leftX = feet.x - palHalfWidth - gap - w
        let rightFits = rightX + w <= bounds.maxX - margin
        let leftFits = leftX >= bounds.minX + margin
        // The roomier side; on the right by default.
        let x: CGFloat
        if rightFits && (!leftFits || bounds.maxX - feet.x >= feet.x - bounds.minX) {
            x = rightX
        } else if leftFits {
            x = leftX
        } else {
            x = min(max(feet.x - w / 2, bounds.minX + margin), bounds.maxX - margin - w)
        }
        return CGRect(x: x, y: y, width: w, height: height)
    }
}
