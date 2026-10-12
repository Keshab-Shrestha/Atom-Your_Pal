import Foundation

/// Runs the ZENO runtime as a child process: starts it, reads its events, sends it commands,
/// restarts it when it fails and stops it cleanly (ADR-034, docs/island-protocol.md).
///
/// All state lives on `queue`; callbacks are delivered on it too. The app passes the main queue.
public final class RuntimeSupervisor: @unchecked Sendable {
    public enum Status: Equatable, Sendable {
        case stopped
        /// The process is running; a `ready` event follows once it has loaded.
        case running(pid: Int32)
        /// It exited unexpectedly and will be started again after this many seconds.
        case restarting(after: Double)
        /// Configuration is invalid: not restarted until the user fixes it and starts again.
        case configError(String)
        /// It failed repeatedly: not restarted until the user starts it again.
        case failed(String)
    }

    public typealias EventHandler = @Sendable (IslandEvent) -> Void
    public typealias StatusHandler = @Sendable (Status) -> Void

    private let launch: RuntimeLaunch
    private var policy: RestartPolicy
    private let queue: DispatchQueue
    private let log: IslandLog
    private let stopTimeout: Double
    private let onEvent: EventHandler
    private let onStatus: StatusHandler

    // State, accessed only on `queue`.
    private var status: Status = .stopped
    private var process: Process?
    private var input: FileHandle?
    private var generation = 0
    private var startedAt = Date()
    private var stopping = false
    private var stopCompletions: [@Sendable () -> Void] = []
    private var stdoutLines = LineBuffer()
    private var stderrLines = LineBuffer(maxLineBytes: 8192)
    private var stderrTail: [String] = []
    private var lastRuntimeError: RuntimeError?
    private var exitCode: Int32?
    private var stdoutClosed = false
    private var pending: [DispatchWorkItem] = [] // restart and stop-escalation timers

    public init(
        launch: RuntimeLaunch,
        policy: RestartPolicy = RestartPolicy(),
        queue: DispatchQueue = .main,
        log: IslandLog = IslandLog(url: nil),
        stopTimeout: Double = 3,
        onEvent: @escaping EventHandler,
        onStatus: @escaping StatusHandler = { _ in }
    ) {
        self.launch = launch
        self.policy = policy
        self.queue = queue
        self.log = log
        self.stopTimeout = stopTimeout
        self.onEvent = onEvent
        self.onStatus = onStatus
        // Writing to a runtime that has just exited must be an error we handle, not a signal that kills the app.
        signal(SIGPIPE, SIG_IGN)
    }

    /// Starts the runtime. Also restarts it after a configuration error or repeated failure.
    public func start() {
        queue.async { [self] in
            guard process == nil else { return }
            cancelPending()
            policy.reset()
            spawn()
        }
    }

    /// Sends a command. Ignored (and logged) if the runtime is not running.
    public func send(_ command: IslandCommand) {
        queue.async { [self] in
            guard let input, !stopping else {
                log.warn("island.command_dropped", ["command": command.type])
                return
            }
            do {
                try input.write(contentsOf: Data(command.line.utf8))
            } catch {
                log.warn("island.command_failed", ["command": command.type, "message": error.localizedDescription])
            }
        }
    }

    /// Asks the runtime to quit, escalating to SIGTERM and then SIGKILL if it does not.
    /// `completion` runs on `queue` once it has exited (at once if it is not running).
    public func stop(completion: @escaping @Sendable () -> Void = {}) {
        queue.async { [self] in
            cancelPending()
            guard let process else {
                setStatus(.stopped)
                completion()
                return
            }
            stopCompletions.append(completion)
            if stopping { return }
            stopping = true
            let pid = process.processIdentifier
            if let input {
                try? input.write(contentsOf: Data(IslandCommand.quit.line.utf8))
                try? input.close()
                self.input = nil
            }
            let gen = generation
            schedule(after: stopTimeout) { [self] in
                guard gen == generation, self.process != nil else { return }
                log.warn("island.runtime.stop_escalated", ["signal": "SIGTERM", "pid": Int(pid)])
                kill(pid, SIGTERM)
            }
            schedule(after: stopTimeout + 2) { [self] in
                guard gen == generation, self.process != nil else { return }
                log.error("island.runtime.stop_escalated", ["signal": "SIGKILL", "pid": Int(pid)])
                kill(pid, SIGKILL)
            }
        }
    }

    /// The current status (for tests and diagnostics); reads synchronously from `queue`.
    public func currentStatus() -> Status {
        queue.sync { status }
    }

    // MARK: - Process lifecycle

    private func spawn() {
        generation += 1
        let gen = generation
        stopping = false
        stdoutLines = LineBuffer()
        stderrLines = LineBuffer(maxLineBytes: 8192)
        stderrTail = []
        lastRuntimeError = nil
        exitCode = nil
        stdoutClosed = false
        startedAt = Date()

        let process = Process()
        process.executableURL = launch.executable
        process.arguments = launch.arguments
        process.currentDirectoryURL = launch.directory
        process.environment = launch.environment
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        let queue = self.queue
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            guard let self else { return }
            queue.async { self.received(stdout: data, generation: gen) }
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil }
            guard let self else { return }
            queue.async { self.received(stderr: data, generation: gen) }
        }
        process.terminationHandler = { [weak self] process in
            let code = process.terminationReason == .uncaughtSignal ? 128 + process.terminationStatus : process.terminationStatus
            guard let self else { return }
            queue.async { self.exited(code: code, generation: gen) }
        }

        do {
            try process.run()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            log.error("island.runtime.spawn_failed", ["node": launch.executable.path, "message": error.localizedDescription])
            lastRuntimeError = RuntimeError(stage: "runtime", message: "Could not start ZENO's runtime: \(error.localizedDescription)")
            afterExit(code: 127, uptime: 0)
            return
        }
        self.process = process
        input = stdin.fileHandleForWriting
        log.info("island.runtime.start", ["pid": Int(process.processIdentifier), "node": launch.executable.path])
        setStatus(.running(pid: process.processIdentifier))
    }

    private func received(stdout data: Data, generation gen: Int) {
        guard gen == generation else { return }
        if data.isEmpty {
            for item in stdoutLines.finish() { handle(item) }
            stdoutClosed = true
            finishIfDone()
            return
        }
        for item in stdoutLines.append(data) { handle(item) }
    }

    private func received(stderr data: Data, generation gen: Int) {
        guard gen == generation else { return }
        let items = data.isEmpty ? stderrLines.finish() : stderrLines.append(data)
        for case .line(let line) in items where !line.isEmpty {
            stderrTail.append(String(line.prefix(300)))
            if stderrTail.count > 5 { stderrTail.removeFirst() }
        }
    }

    private func handle(_ item: LineBuffer.Item) {
        guard case .line(let line) = item else {
            log.warn("island.protocol.bad_event", ["reason": "line too long"])
            return
        }
        if line.trimmingCharacters(in: .whitespaces).isEmpty { return }
        let event: IslandEvent
        do {
            event = try decodeEvent(line)
        } catch {
            // The line itself is not logged: it could contain what was said.
            log.warn("island.protocol.bad_event", ["reason": "\(error)"])
            return
        }
        switch event {
        case .ready(let info):
            log.info("island.runtime.ready", ["ms": Int(Date().timeIntervalSince(startedAt) * 1000), "protocol": info.protocolVersion])
            if info.protocolVersion != supportedProtocolVersion {
                log.warn("island.protocol.version_mismatch", ["runtime": info.protocolVersion, "island": supportedProtocolVersion])
            }
        case .error(let error):
            lastRuntimeError = error
        default:
            break
        }
        onEvent(event)
    }

    private func exited(code: Int32, generation gen: Int) {
        guard gen == generation else { return }
        exitCode = code
        finishIfDone()
        // Normally stdout closes with the process. If a grandchild still holds it, do not wait forever.
        schedule(after: 1) { [self] in
            guard gen == generation, exitCode != nil, process != nil else { return }
            stdoutClosed = true
            finishIfDone()
        }
    }

    /// The runtime is gone once it has exited and its output has been read to the end.
    private func finishIfDone() {
        guard let code = exitCode, stdoutClosed, process != nil else { return }
        let uptime = Date().timeIntervalSince(startedAt)
        process = nil
        input = nil
        generation += 1 // ignore anything still in flight from the old process
        afterExit(code: code, uptime: uptime)
    }

    private func afterExit(code: Int32, uptime: Double) {
        cancelPending()
        let requested = stopping
        stopping = false
        var fields: [String: Any] = ["code": Int(code), "uptimeMs": Int(uptime * 1000), "requested": requested]
        if !requested, code != 0, let last = stderrTail.last { fields["lastStderr"] = last }
        log.write(requested || code == 0 ? .info : .error, "island.runtime.exit", fields)

        switch policy.decide(exitCode: code, uptime: uptime, requested: requested) {
        case .stay:
            setStatus(.stopped)
        case .configError:
            let message = lastRuntimeError?.message ?? "ZENO's configuration is invalid. Details are in logs/atom.log."
            log.error("island.runtime.config_error")
            setStatus(.configError(message))
        case .giveUp:
            let reason = lastRuntimeError?.message ?? "it exited with code \(code)"
            log.error("island.runtime.gave_up", ["failures": policy.consecutiveFailures - 1])
            setStatus(.failed("ZENO's runtime keeps stopping: \(reason)"))
        case .restart(let delay):
            log.warn("island.runtime.restart", ["delayMs": Int(delay * 1000), "attempt": policy.consecutiveFailures])
            setStatus(.restarting(after: delay))
            schedule(after: delay) { [self] in
                guard process == nil, case .restarting = status else { return }
                spawn()
            }
        }
        let completions = stopCompletions
        stopCompletions = []
        for completion in completions { completion() }
    }

    // MARK: - Helpers

    private func setStatus(_ next: Status) {
        guard next != status else { return }
        status = next
        onStatus(next)
    }

    private func schedule(after seconds: Double, _ work: @escaping @Sendable () -> Void) {
        let item = DispatchWorkItem(block: work)
        pending.append(item)
        queue.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    private func cancelPending() {
        for item in pending { item.cancel() }
        pending = []
    }
}
