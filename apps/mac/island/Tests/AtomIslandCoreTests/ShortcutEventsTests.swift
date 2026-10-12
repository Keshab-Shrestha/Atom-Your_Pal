import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Shortcuts: settings.open and media.key events (ADR-071)")
struct ShortcutEventsTests {
    @Test func decodesSettingsOpen() throws {
        let event = try decodeEvent(#"{"type":"settings.open"}"#)
        #expect(event == .settingsOpen)
        #expect(event.name == "settings.open")
    }

    @Test func decodesPlayPause() throws {
        let event = try decodeEvent(#"{"type":"media.key","key":"playpause"}"#)
        #expect(event == .mediaKey(.playPause))
        #expect(event.name == "media.key")
    }

    @Test func anyOtherKeyIsABadEvent() {
        #expect(throws: ProtocolError.invalidValue(event: "media.key", field: "key")) { try decodeEvent(#"{"type":"media.key","key":"next"}"#) }
        #expect(throws: ProtocolError.invalidValue(event: "media.key", field: "key")) { try decodeEvent(#"{"type":"media.key","key":"PlayPause"}"#) }
        #expect(throws: ProtocolError.invalidValue(event: "media.key", field: "key")) { try decodeEvent(#"{"type":"media.key","key":16}"#) }
        #expect(throws: ProtocolError.missingField(event: "media.key", field: "key")) { try decodeEvent(#"{"type":"media.key"}"#) }
    }

    @Test func playPauseEventFieldsForKeyDownAndUp() {
        let down = MediaKey.playPause.event(down: true)
        #expect(down.flags == 0xa00)
        #expect(down.data1 == (16 << 16) | 0xa00)
        let up = MediaKey.playPause.event(down: false)
        #expect(up.flags == 0xb00)
        #expect(up.data1 == (16 << 16) | 0xb00)
    }

    @Test func missingPermissionNoticeIsPlain() {
        var status = IslandStatus()
        status.apply(.notice(kind: "media_key_permission", message: "To press play/pause, allow ZENO in System Settings → Privacy & Security → Accessibility."))
        #expect(status.kind == .notice)
        #expect(status.title == "Can't press play/pause")
        #expect(status.detail == "Allow ZENO under Accessibility")
    }
}
