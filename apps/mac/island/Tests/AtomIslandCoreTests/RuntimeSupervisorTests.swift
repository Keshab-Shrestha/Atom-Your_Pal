import Foundation
import Testing
@testable import AtomIslandCore

/// Exercises RuntimeSupervisor against real child processes: small shell scripts that behave like the
/// runtime (or misbehave), so starting, reading, restarting and stopping are tested for real.
@Suite("RuntimeSupervisor", .serialized)
struct RuntimeSupervisorTests {
    /// Collects everything the supervisor reports, safely across threads.
    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var _events: [IslandEvent] = []
        private var _statuses: [RuntimeSupervisor.Status] = []

        func add(_ e: IslandEvent) { lock.withLock { _events.append(e) } }
        func add(_ s: RuntimeSupervisor.Status) { lock.withLock { _statuses.append(s) } }
        var events: [IslandEvent] { lock.withLock { _events } }
        var statuses: [RuntimeSupervisor.Status] { lock.withLock { _statuses } }
        var pids: [Int32] {
            statuses.compactMap { if case .running(let pid) = $0 { return pid } else { return nil } }
        }
    }

    let dir: URL

    init() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("atom-island-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// A launch that runs `script` with /bin/sh in a scratch folder.
    func launch(_ script: String) -> RuntimeLaunch {
        RuntimeLaunch(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", script],
            directory: dir,
            environment: ["PATH": "/usr/bin:/bin"])
    }

    func make(
        _ script: String,
        policy: RestartPolicy = RestartPolicy(delays: [0.05], stableAfter: 30, maxConsecutiveFailures: 3),
        stopTimeout: Double = 3,
        log: IslandLog = IslandLog(url: nil)
    ) -> (RuntimeSupervisor, Recorder) {
        let recorder = Recorder()
        let queue = DispatchQueue(label: "test.supervisor")
        let supervisor = RuntimeSupervisor(
            launch: launch(script), policy: policy, queue: queue, log: log, stopTimeout: stopTimeout,
            onEvent: { recorder.add($0) }, onStatus: { recorder.add($0) })
        return (supervisor, recorder)
    }

    func waitUntil(_ timeout: Double = 5, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { Issue.record("timed out"); return }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    func stop(_ supervisor: RuntimeSupervisor) async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in supervisor.stop { done.resume() } }
    }

    static let ready = #"{"type":"ready","protocol":1,"provider":"fake","model":"m","microphone":":default","voice":true}"#

    @Test func startsReadsEventsAndSendsCommands() async throws {
        // Echoes each command back as a "state" event so the round trip is visible; exits on quit.
        let script = """
        echo '\(Self.ready)'
        while IFS= read -r line; do
          case "$line" in
            *talk.start*) echo '{"type":"state","state":"listening"}' ;;
            *quit*) exit 0 ;;
          esac
        done
        """
        let (supervisor, recorder) = make(script)
        supervisor.start()
        try await waitUntil { recorder.events.first == .ready(ReadyInfo(protocolVersion: 1, provider: "fake", model: "m", microphone: ":default", voice: true)) }
        supervisor.send(.talkStart)
        try await waitUntil { recorder.events.contains(.state(.listening)) }
        await stop(supervisor)
        #expect(supervisor.currentStatus() == .stopped)
        #expect(recorder.pids.count == 1) // a requested stop is not restarted
    }

    @Test func badOutputLinesAreSkipped() async throws {
        let script = """
        echo 'npm WARN something'
        echo '{"type":"state"}'
        printf '{"type":"state",'; sleep 0.05; echo '"state":"thinking"}'
        exec cat > /dev/null
        """
        let (supervisor, recorder) = make(script)
        supervisor.start()
        try await waitUntil { recorder.events == [.state(.thinking)] }
        await stop(supervisor)
    }

    @Test func restartsAfterACrash() async throws {
        let marker = dir.appendingPathComponent("runs").path
        // First run crashes at once; the second stays up.
        let script = """
        echo run >> '\(marker)'
        if [ "$(wc -l < '\(marker)')" -lt 2 ]; then echo boom >&2; exit 3; fi
        echo '\(Self.ready)'
        exec cat > /dev/null
        """
        let (supervisor, recorder) = make(script)
        supervisor.start()
        try await waitUntil { recorder.events.contains { if case .ready = $0 { true } else { false } } }
        #expect(recorder.pids.count == 2)
        #expect(recorder.statuses.contains(.restarting(after: 0.05)))
        await stop(supervisor)
    }

    @Test func aConfigErrorIsShownAndNotRestarted() async throws {
        let script = """
        echo '{"type":"error","stage":"config","message":"Invalid configuration: ANTHROPIC_API_KEY is required"}'
        exit 78
        """
        let (supervisor, recorder) = make(script)
        supervisor.start()
        try await waitUntil { if case .configError = supervisor.currentStatus() { true } else { false } }
        #expect(supervisor.currentStatus() == .configError("Invalid configuration: ANTHROPIC_API_KEY is required"))
        try await Task.sleep(for: .milliseconds(200))
        #expect(recorder.pids.count == 1)
    }

    @Test func givesUpAfterRepeatedQuickFailures() async throws {
        let (supervisor, recorder) = make(#"echo '{"type":"error","stage":"runtime","message":"bug"}'; exit 1"#)
        supervisor.start()
        try await waitUntil { if case .failed = supervisor.currentStatus() { true } else { false } }
        #expect(recorder.pids.count == 4) // first run + 3 restarts
        #expect(supervisor.currentStatus() == .failed("ATOM's runtime keeps stopping: bug"))
        // Starting again by hand gets a fresh set of attempts.
        supervisor.start()
        try await waitUntil { recorder.pids.count > 4 }
        await stop(supervisor)
    }

    @Test func aRuntimeThatIgnoresQuitIsTerminated() async throws {
        // Ignores quit and the end of stdin; only a signal stops it.
        let script = """
        trap '' PIPE
        echo '\(Self.ready)'
        while true; do sleep 0.05; done
        """
        let (supervisor, recorder) = make(script, stopTimeout: 0.3)
        supervisor.start()
        try await waitUntil { !recorder.events.isEmpty }
        let started = Date()
        await stop(supervisor)
        #expect(Date().timeIntervalSince(started) < 2.5)
        #expect(supervisor.currentStatus() == .stopped)
        #expect(recorder.pids.count == 1)
    }

    @Test func aMissingExecutableIsAFailureNotACrash() async throws {
        let recorder = Recorder()
        let supervisor = RuntimeSupervisor(
            launch: RuntimeLaunch(executable: URL(fileURLWithPath: "/nonexistent/node"), arguments: [], directory: dir, environment: [:]),
            policy: RestartPolicy(delays: [0.01], maxConsecutiveFailures: 1),
            queue: DispatchQueue(label: "test"),
            onEvent: { recorder.add($0) }, onStatus: { recorder.add($0) })
        supervisor.start()
        try await waitUntil { if case .failed = supervisor.currentStatus() { true } else { false } }
        if case .failed(let message) = supervisor.currentStatus() {
            #expect(message.contains("Could not start ATOM's runtime"))
        }
    }

    @Test func commandsWhileStoppedAreDropped() async throws {
        let (supervisor, _) = make("exec cat > /dev/null")
        supervisor.send(.talkStart) // nothing running: must not crash
        await stop(supervisor)
        #expect(supervisor.currentStatus() == .stopped)
    }

    @Test func logsLifecycleWithoutSpokenText() async throws {
        let logURL = dir.appendingPathComponent("atom.log")
        let log = IslandLog(url: logURL)
        let script = """
        echo '\(Self.ready)'
        echo '{"type":"transcript","text":"my secret words"}'
        echo 'garbage that might contain secret words'
        exec cat > /dev/null
        """
        let (supervisor, recorder) = make(script, log: log)
        supervisor.start()
        try await waitUntil { recorder.events.count == 2 }
        await stop(supervisor)
        log.flush()
        let text = try String(contentsOf: logURL, encoding: .utf8)
        let events = text.split(separator: "\n").compactMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any])?["event"] as? String
        }
        #expect(events == ["island.runtime.start", "island.runtime.ready", "island.protocol.bad_event", "island.runtime.exit"])
        #expect(!text.contains("secret"))
    }
}
