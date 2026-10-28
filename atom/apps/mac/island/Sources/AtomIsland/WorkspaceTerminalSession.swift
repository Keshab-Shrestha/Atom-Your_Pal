import AppKit
import Observation
import SwiftTerm
import AtomIslandCore

/// Native input/output only. No host command, model context, automatic shell launch or disk transcript.
@MainActor @Observable
final class WorkspaceTerminalSession: NSObject, @preconcurrency TerminalViewDelegate {
    private(set) var running = false
    private(set) var stopping = false
    private(set) var started = false
    private(set) var notice: String?
    private(set) var directory = ""
    private(set) var generation = UUID()
    @ObservationIgnored private var current: TerminalView?
    @ObservationIgnored private var process: WorkspaceTerminalProcess?

    var terminalView: TerminalView {
        if let current { return current }
        let options = TerminalOptions(scrollback: 2000, enableSixelReported: false, kittyImageCacheLimitBytes: 4 * 1024 * 1024)
        let view = WorkspaceTerminalNativeView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), font: .monospacedSystemFont(ofSize: 12, weight: .regular), options: options)
        view.terminalDelegate = self
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.textArea)
        view.setAccessibilityLabel("Workspace terminal")
        view.setAccessibilityHelp("Interactive shell. Type commands here; Control-C interrupts a foreground command. Output is not sent to chat.")
        current = view
        return view
    }
    func start(directory: URL) {
        guard !running, !stopping else { return }
        reset()
        let view = terminalView
        let process = WorkspaceTerminalProcess()
        self.process = process; self.directory = directory.path
        process.output = { [weak self, weak process] bytes in
            guard let self, self.process === process else { return }
            self.current?.feed(byteArray: bytes[...])
            if let view = self.current { NSAccessibility.post(element: view, notification: .valueChanged) }
        }
        process.failure = { [weak self, weak process] message in
            guard let self, self.process === process else { return }; self.notice = message
        }
        process.ended = { [weak self, weak process] status in
            guard let self, self.process === process else { return }
            self.running = false; self.stopping = false
            if self.notice == nil { self.notice = status == 0 ? "Shell exited. Start a new session when ready." : "Shell ended. Start a new session when ready." }
        }
        if process.start(directory: directory, columns: view.getTerminal().cols, rows: view.getTerminal().rows) {
            running = true; started = true
        }
    }
    func stop() {
        guard running else { return }
        stopping = true; running = false; notice = "Session stopped. Start a new session when ready."
        process?.stop()
    }
    func reset() {
        process?.output = nil; process?.ended = nil; process?.failure = nil; process?.stop(); process = nil
        current?.terminalDelegate = nil; current = nil
        running = false; stopping = false; started = false; directory = ""; notice = nil; generation = UUID()
    }
    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        guard current === source else { return }; process?.resize(columns: newCols, rows: newRows)
    }
    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        guard current === source, running else { return }; process?.send(data)
    }
    // Terminal escape sequences must not open apps, read/write the system clipboard or export content.
    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    func clipboardCopy(source: TerminalView, content: Data) {}
    func clipboardRead(source: TerminalView) -> Data? { nil }
    func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func bell(source: TerminalView) {}
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

/// SwiftTerm's macOS view supplies terminal input/rendering, but no readable AX value of its own.
private final class WorkspaceTerminalNativeView: TerminalView {
    private var focusWhenAttached = true
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard focusWhenAttached, let window else { return }
        focusWhenAttached = false
        window.makeFirstResponder(self)
    }
    override func accessibilityValue() -> Any? {
        String(decoding: getTerminal().getBufferAsData(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
