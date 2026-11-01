import Foundation

/// A system media key the runtime asks the island to press (ADR-071), from the `media.key` event. The press goes to
/// whatever app macOS has as its Now Playing source.
public enum MediaKey: String, Sendable, Equatable {
    case playPause = "playpause"

    /// NX_KEYTYPE_PLAY in IOKit's ev_keymap.h.
    static let playKeyType = 16

    /// The `modifierFlags` raw value and `data1` of the `.systemDefined` event (subtype 8) for the key going down or up.
    public func event(down: Bool) -> (flags: UInt, data1: Int) {
        let state = down ? 0xa : 0xb
        return (UInt(state << 8), (Self.playKeyType << 16) | (state << 8))
    }
}
