import CoreGraphics
import Foundation

/// Wisp's flight to point at something and back (ADR-077): a quadratic Bézier from `start` to `end` whose control
/// point is the midpoint raised above the straight line, so Wisp arcs up and comes down onto the place. Progress is
/// eased with smoothstep, so it lifts off and lands gently. Screen points in AppKit coordinates (y up); times in
/// seconds on any steady clock.
public struct WispFlight: Sendable, Equatable {
    /// How high the control point sits above the midpoint, as a share of the distance, and its cap in points.
    public static let arcShare: CGFloat = 0.25
    public static let maxArc: CGFloat = 160
    /// The most Wisp leans while flying, in radians (clockwise when heading right).
    public static let maxLean = 0.15
    /// Shorter than this, there is nowhere to fly.
    static let minDistance: CGFloat = 0.5

    public let start: CGPoint
    public let end: CGPoint
    public let startTime: Double
    public let duration: Double
    let control: CGPoint
    let distance: CGFloat

    public init(from start: CGPoint, to end: CGPoint, at time: Double) {
        self.start = start
        self.end = end
        startTime = time
        distance = hypot(end.x - start.x, end.y - start.y)
        duration = min(max(0.6 + Double(distance) / 1000 * 0.8, 0.6), 1.4)
        let arc = min(distance * Self.arcShare, Self.maxArc)
        control = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + arc) // always upward on screen
    }

    /// 3t² − 2t³, clamped to 0...1.
    public static func smoothstep(_ t: Double) -> Double {
        let x = min(max(t, 0), 1)
        return x * x * (3 - 2 * x)
    }

    public func isDone(at time: Double) -> Bool {
        distance < Self.minDistance || time >= startTime + duration
    }

    /// Where Wisp's feet are at `time`: `start` before it begins, exactly `end` once it is done.
    public func position(at time: Double) -> CGPoint {
        if isDone(at: time) { return end }
        let s = CGFloat(Self.smoothstep(progress(at: time)))
        let a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s
        return CGPoint(x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y)
    }

    /// The direction of travel along the curve at `time`, in radians (atan2, y up): positive while rising.
    public func tangentAngle(at time: Double) -> Double {
        let s = CGFloat(Self.smoothstep(progress(at: time)))
        let dx = 2 * (1 - s) * (control.x - start.x) + 2 * s * (end.x - control.x)
        let dy = 2 * (1 - s) * (control.y - start.y) + 2 * s * (end.y - control.y)
        return Double(atan2(dy, dx))
    }

    /// How far Wisp leans into its flight at `time`, in radians clockwise: forward with the horizontal part of the
    /// tangent, scaled by how fast it is going, so it is upright at lift-off and on landing.
    public func lean(at time: Double) -> Double {
        if isDone(at: time) { return 0 }
        let u = progress(at: time)
        return Self.maxLean * cos(tangentAngle(at: time)) * 4 * u * (1 - u)
    }

    private func progress(at time: Double) -> Double {
        duration > 0 ? min(max((time - startTime) / duration, 0), 1) : 1
    }
}
