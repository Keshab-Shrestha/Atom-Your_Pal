import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-16 (code review): `node --version` ran on the main thread at launch with no time limit.
@Suite("Node version probe")
struct NodeProbeTests {
    func script(_ body: String) throws -> String {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("atom-node-\(UUID().uuidString)")
        try "#!/bin/sh\n\(body)\n".write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    @Test func aWorkingNodeAnswersWithItsVersion() throws {
        let path = try script("echo v22.20.0")
        #expect(RuntimeLocator.probeNodeVersion(at: path)?.contains("v22.20.0") == true)
    }

    @Test func aHungNodeIsGivenUpOnAfterTheTimeout() throws {
        let path = try script("sleep 30")
        let started = Date()
        #expect(RuntimeLocator.probeNodeVersion(at: path, timeout: 0.5) == nil)
        #expect(Date().timeIntervalSince(started) < 5, "it did not wait for the 30 seconds")
    }

    @Test func aFailingOrMissingNodeIsNil() throws {
        #expect(RuntimeLocator.probeNodeVersion(at: try script("exit 3")) == nil)
        #expect(RuntimeLocator.probeNodeVersion(at: "/no/such/node") == nil)
    }
}
