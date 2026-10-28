import Foundation
import Darwin
import AtomPTY

/// A user-operated PTY, with no runtime/agent protocol entry point or transcript persistence.
@MainActor
public final class WorkspaceTerminalProcess {
    public private(set) var pid: pid_t = 0
    public private(set) var running = false
    public var output: (([UInt8]) -> Void)?
    public var ended: ((Int32) -> Void)?
    public var failure: ((String) -> Void)?
    private var master: Int32 = -1
    private var reader: (any DispatchSourceRead)?
    private var writer: (any DispatchSourceWrite)?
    private var monitor: (any DispatchSourceProcess)?
    private var pending: [UInt8] = []

    public init() {}

    /// Never inherit provider credentials, agent variables, shell hooks or project startup configuration.
    public static func environment(home: String = FileManager.default.homeDirectoryForCurrentUser.path) -> [String] {
        ["HOME=\(home)", "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
         "TERM=xterm-256color", "LANG=en_US.UTF-8", "LC_CTYPE=en_US.UTF-8", "HISTSIZE=0", "SAVEHIST=0",
         "PS1=ATOM %1~ %# ", "PS2=> "]
    }

    @discardableResult
    public func start(directory: URL, columns: Int = 80, rows: Int = 24) -> Bool {
        guard pid == 0, directory.isFileURL, directory.path == directory.resolvingSymlinksInPath().path,
              (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return false }
        let args = ["/bin/zsh", "-f"]
        let argv = args.map { strdup($0) } + [nil]
        let env = Self.environment().map { strdup($0) } + [nil]
        defer { argv.forEach { free($0) }; env.forEach { free($0) } }
        var size = Self.size(columns, rows), fd: Int32 = -1
        let child = directory.path.withCString { cwd in
            argv.withUnsafeBufferPointer { argv in env.withUnsafeBufferPointer { env in
                atom_pty_spawn(cwd, argv.baseAddress, env.baseAddress, &size, &fd)
            } }
        }
        guard child > 0 else { failure?("The shell could not start in this project folder. Reopen the project and try again."); return false }
        pid = child; master = fd; running = true
        let reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        reader.setEventHandler { [weak self] in MainActor.assumeIsolated { self?.readAvailable() } }
        reader.setCancelHandler { close(fd) }
        self.reader = reader
        let monitor = DispatchSource.makeProcessSource(identifier: child, eventMask: .exit, queue: .main)
        // Retain until waitpid completes, even if the UI discards a stopped session immediately.
        monitor.setEventHandler { MainActor.assumeIsolated { self.reap() } }
        self.monitor = monitor
        reader.activate(); monitor.activate()
        return true
    }

    public func send(_ bytes: ArraySlice<UInt8>) {
        guard running else { return }
        // Bound queued I/O, never truncate a paste into a different command.
        guard pending.count + bytes.count <= 4 * 1024 * 1024 else { failure?("Terminal input is busy. Wait before pasting again."); return }
        pending.append(contentsOf: bytes)
        drain()
    }
    private func drain() {
        guard running, master >= 0, !pending.isEmpty else { return }
        let count = pending.withUnsafeBytes { Darwin.write(master, $0.baseAddress, $0.count) }
        if count > 0 { pending.removeFirst(count) }
        else if count < 0 && errno != EAGAIN && errno != EINTR { failure?("The terminal could not accept input."); stop(); return }
        if pending.isEmpty { writer?.cancel(); writer = nil }
        else if writer == nil {
            let writer = DispatchSource.makeWriteSource(fileDescriptor: master, queue: .main)
            writer.setEventHandler { [weak self] in MainActor.assumeIsolated { self?.drain() } }
            self.writer = writer; writer.activate()
        }
    }
    public func resize(columns: Int, rows: Int) {
        guard running, master >= 0 else { return }
        var size = Self.size(columns, rows)
        if atom_pty_resize(master, &size) != 0 { failure?("The terminal could not resize. Stop and restart it if the layout is incorrect.") }
    }
    private static func size(_ columns: Int, _ rows: Int) -> winsize {
        winsize(ws_row: UInt16(clamping: max(1, rows)), ws_col: UInt16(clamping: max(1, columns)), ws_xpixel: 0, ws_ypixel: 0)
    }
    private func readAvailable() {
        guard master >= 0 else { return }
        var bytes = [UInt8](repeating: 0, count: 32768)
        // Yield between batches so a noisy process cannot starve Stop or chat controls.
        for _ in 0..<4 {
            let count = bytes.withUnsafeMutableBytes { Darwin.read(master, $0.baseAddress, $0.count) }
            if count > 0 { output?(Array(bytes.prefix(count))) }
            else {
                if count == 0 || (count < 0 && errno != EAGAIN && errno != EINTR) { closeIO() }
                return
            }
        }
    }
    /// Force-end the shell's session. Deliberately daemonized jobs are outside this process/session lifetime.
    public func stop() {
        guard pid > 1 else { return }
        running = false
        atom_pty_stop_session(pid)
        closeIO()
        // Keep the process monitor until it reaps this exact child. Never schedule a later PID-based kill.
    }
    private func reap() {
        guard pid > 1 else { return }
        readAvailable()
        atom_pty_stop_session(pid) // also collect normal background jobs after a shell exits
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        pid = 0; running = false; closeIO(); monitor?.cancel(); monitor = nil
        ended?(status)
    }
    private func closeIO() {
        writer?.cancel(); writer = nil; reader?.cancel(); reader = nil; master = -1; pending.removeAll()
    }
}
