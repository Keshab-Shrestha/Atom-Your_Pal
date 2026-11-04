import AppKit
import ArkIslandCore

/// Quiet the Mac while ARK listens (2026-11-04). Reads and sets the system output volume with AppleScript (no extra permission:
/// it does not control another app). Off by default (Settings → Dictation).
@MainActor
final class AudioDucker {
    private var duck = AudioDuck()

    func begin() {
        guard let target = duck.begin(current: Self.volume()) else { return }
        Self.setVolume(target)
    }

    func end() {
        guard duck.isDucked, let restore = duck.end(current: Self.volume()) else { return }
        Self.setVolume(restore)
    }

    private static func volume() -> Int? {
        var error: NSDictionary?
        guard let result = NSAppleScript(source: "output volume of (get volume settings)")?.executeAndReturnError(&error), error == nil else { return nil }
        let value = result.int32Value
        return result.descriptorType == typeSInt32 || result.descriptorType == typeSInt16 ? Int(value) : nil // "missing value": no volume to set
    }

    private static func setVolume(_ value: Int) {
        var error: NSDictionary?
        NSAppleScript(source: "set volume output volume \(max(0, min(100, value)))")?.executeAndReturnError(&error)
    }
}
