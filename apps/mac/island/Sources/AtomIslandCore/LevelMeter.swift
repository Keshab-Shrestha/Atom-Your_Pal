import Foundation

/// Turns the runtime's `mic.level` peaks (20 per second, 0–1 linear) into a steady meter:
/// rises at once, falls gently, and uses a decibel scale so quiet speech still moves it.
public struct LevelMeter: Sendable, Equatable {
    /// Displayed level, 0–1.
    public private(set) var value: Double = 0
    /// Recent displayed levels, newest last, for a small waveform.
    public private(set) var history: [Double]
    /// How much of the gap to a lower level is closed per update (0–1). Lower: slower fall.
    public var fall: Double
    /// The quietest level shown above zero, in dBFS.
    public var floorDb: Double

    public init(bars: Int = 12, fall: Double = 0.35, floorDb: Double = -50) {
        history = Array(repeating: 0, count: max(1, bars))
        self.fall = fall
        self.floorDb = floorDb
    }

    /// Maps a linear peak to 0–1 on a decibel scale: `floorDb` and below → 0, full scale → 1.
    public func scaled(_ peak: Double) -> Double {
        guard peak > 0 else { return 0 }
        let db = 20 * log10(min(1, peak))
        return min(1, max(0, (db - floorDb) / -floorDb))
    }

    public mutating func add(_ peak: Double) {
        let target = scaled(peak)
        value = target >= value ? target : value + (target - value) * fall
        if value < 0.001 { value = 0 }
        history.removeFirst()
        history.append(value)
    }

    public mutating func reset() {
        value = 0
        history = Array(repeating: 0, count: history.count)
    }
}
