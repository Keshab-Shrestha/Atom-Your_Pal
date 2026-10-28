import Foundation
import Darwin
import Testing
@testable import AtomIslandCore

@Suite("Workspace terminal") @MainActor
struct WorkspaceTerminalTests {
    private func wait(_ condition: () -> Bool) async -> Bool {
        let until = ContinuousClock.now + .seconds(5)
        while !condition(), ContinuousClock.now < until { try? await Task.sleep(for: .milliseconds(20)) }
        return condition()
    }
    private func folder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("atom-terminal-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        return folder
    }
    @Test func environmentDoesNotForwardAppCredentialsOrShellHooks() {
        let env = WorkspaceTerminalProcess.environment(home: "/Users/fictional")
        #expect(env.contains("HOME=/Users/fictional")); #expect(env.contains("SAVEHIST=0"))
        let names = Set(env.compactMap { $0.split(separator: "=", maxSplits: 1).first.map(String.init) })
        #expect(names == ["HOME", "PATH", "TERM", "LANG", "LC_CTYPE", "HISTSIZE", "SAVEHIST", "PS1", "PS2"])
    }
    @Test func missingFilesAndSymlinkRootsDoNotLaunch() throws {
        let folder = try folder(); defer { try? FileManager.default.removeItem(at: folder) }
        let link = folder.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: folder)
        let process = WorkspaceTerminalProcess()
        #expect(!process.start(directory: link))
        #expect(!process.start(directory: folder.appendingPathComponent("missing")))
        #expect(process.pid == 0); #expect(!process.running)
    }
    @Test func interactiveShellHasProjectCwdCleanEnvironmentAndRealResize() async throws {
        let folder = try folder(); defer { try? FileManager.default.removeItem(at: folder) }
        let process = WorkspaceTerminalProcess(); var text = ""
        process.output = { text += String(decoding: $0, as: UTF8.self) }
        #expect(process.start(directory: folder)); defer { process.stop() }
        let physical = try #require(realpath(folder.path, nil)); defer { free(physical) }
        let expectedDirectory = String(cString: physical)
        process.send(Array("stty -echo; printf 'CWD_%s_END\\n' \"$PWD\"; test -z \"${OPENAI_API_KEY+x}\" && printf 'ENV_%s_END\\n' unset\r".utf8)[...])
        #expect(await wait { text.contains("CWD_\(expectedDirectory)_END") && text.contains("ENV_unset_END") })
        process.resize(columns: 96, rows: 35)
        process.send(Array("stty size; printf 'RESIZE_%s\\n' READY\r".utf8)[...])
        #expect(await wait { text.contains("35 96") && text.contains("RESIZE_READY") })
        process.send(Array("exit 0\r".utf8)[...])
        #expect(await wait { process.pid == 0 }); #expect(!process.running)
    }
    @Test func controlCInterruptsForegroundWithoutSendingAChatOrEndingShell() async throws {
        let folder = try folder(); defer { try? FileManager.default.removeItem(at: folder) }
        let process = WorkspaceTerminalProcess(); var text = ""
        process.output = { text += String(decoding: $0, as: UTF8.self) }
        #expect(process.start(directory: folder)); defer { process.stop() }
        process.send(Array("stty -echo; printf 'SLEEP_%s\\n' START; /bin/sleep 60\r".utf8)[...])
        #expect(await wait { text.contains("SLEEP_START") })
        try? await Task.sleep(for: .milliseconds(100))
        process.send([3]); process.send(Array("printf 'INTERRUPT_%s\\n' READY\r".utf8)[...])
        #expect(await wait { text.contains("INTERRUPT_READY") }); #expect(process.running)
        process.stop(); #expect(await wait { process.pid == 0 })
    }
    @Test func stopKillsForegroundAndBackgroundSessionJobsAndReapsShell() async throws {
        let folder = try folder(); defer { try? FileManager.default.removeItem(at: folder) }
        let process = WorkspaceTerminalProcess(); var text = ""
        process.output = { text += String(decoding: $0, as: UTF8.self) }
        #expect(process.start(directory: folder)); defer { process.stop() }
        let shell = process.pid
        process.send(Array("stty -echo; /bin/sleep 60 & printf 'BACKGROUND_%s_END\\n' $!; /bin/sleep 60\r".utf8)[...])
        #expect(await wait { text.range(of: #"BACKGROUND_[0-9]+_END"#, options: .regularExpression) != nil })
        let range = try #require(text.range(of: #"BACKGROUND_[0-9]+_END"#, options: .regularExpression))
        let job = try #require(Int32(text[range].dropFirst(11).dropLast(4)))
        process.stop(); process.stop()
        #expect(await wait { process.pid == 0 })
        #expect(kill(shell, 0) == -1)
        #expect(await wait { kill(job, 0) == -1 })
    }
    @Test func discardingStoppedOwnerStillReapsWithoutAStaleKill() async throws {
        let folder = try folder(); defer { try? FileManager.default.removeItem(at: folder) }
        var process: WorkspaceTerminalProcess? = WorkspaceTerminalProcess()
        #expect(process?.start(directory: folder) == true)
        let pid = try #require(process?.pid)
        process?.stop(); process = nil
        #expect(await wait { kill(pid, 0) == -1 })
    }
}
