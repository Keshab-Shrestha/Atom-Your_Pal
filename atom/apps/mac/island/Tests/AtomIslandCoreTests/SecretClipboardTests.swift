import AppKit
import Testing
@testable import AtomIslandCore

/// 2026-10-16 (code review): the Local API token was copied as ordinary text and kept by every clipboard history.
@Suite("Secret clipboard", .serialized)
struct SecretClipboardTests {
    func board() -> NSPasteboard { NSPasteboard(name: NSPasteboard.Name("atom-test-\(UUID().uuidString)")) }

    @Test func theSecretIsCopiedAndMarkedConcealedAndTransient() {
        let b = board()
        SecretClipboard.copy("s3cret", to: b, clearAfter: 60)
        #expect(b.string(forType: .string) == "s3cret")
        let types = b.types ?? []
        #expect(types.contains(SecretClipboard.concealed))
        #expect(types.contains(SecretClipboard.transient))
        b.clearContents()
    }

    @Test func itIsClearedAfterTheDelayIfNothingElseWasCopied() async throws {
        let b = board()
        SecretClipboard.copy("s3cret", to: b, clearAfter: 0.2)
        try await Task.sleep(for: .seconds(0.6))
        #expect(b.string(forType: .string) == nil)
    }

    @Test func somethingCopiedLaterIsNotWipedOut() async throws {
        let b = board()
        SecretClipboard.copy("s3cret", to: b, clearAfter: 0.3)
        b.clearContents()
        b.setString("my own text", forType: .string)
        try await Task.sleep(for: .seconds(0.7))
        #expect(b.string(forType: .string) == "my own text")
        b.clearContents()
    }

    /// 2026-10-16 (code review): quitting inside the 60 seconds left the token on the clipboard for good.
    @Test func quittingClearsASecretThatIsStillThere() {
        let b = board()
        SecretClipboard.copy("s3cret", to: b, clearAfter: 60)
        SecretClipboard.clearIfStillSecret()
        #expect(b.string(forType: .string) == nil)
    }

    @Test func quittingLeavesSomethingCopiedLaterAlone() {
        let b = board()
        SecretClipboard.copy("s3cret", to: b, clearAfter: 60)
        b.clearContents()
        b.setString("my own text", forType: .string)
        SecretClipboard.clearIfStillSecret()
        #expect(b.string(forType: .string) == "my own text")
        b.clearContents()
    }
}

