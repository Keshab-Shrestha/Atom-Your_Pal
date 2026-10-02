import AppKit
import SwiftUI
import ZenoIslandCore

/// Places the island at the left edge of the display with the menu bar, below the menu bar (ADR-037),
/// and slides it in and out as the pointer reaches that edge. Pointer tracking uses mouse-moved events,
/// which need no permission.
@MainActor
final class IslandController {
    let model = IslandModel()
    private let panel = IslandPanel()
    private let hosting: NSHostingView<IslandView>
    private var hover = HoverController()
    private var geometry: IslandGeometry
    private var presentation = IslandGeometry.Presentation.compact
    private var shown = false
    private var monitors: [Any] = []
    private var observers: [NSObjectProtocol] = []
    private var recheck: Timer?
    private var lastTrigger = false
    private var lastTitle = ""
    /// Development only: when set, a PNG of the island is written here each time its title changes.
    private let snapshotDirectory = ProcessInfo.processInfo.environment["ZENO_ISLAND_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
    private var snapshotCount = 0
    private let trace: (String) -> Void

    /// Slide duration; with Reduce Motion the island fades instead.
    private let slideDuration = 0.24
    /// How long the island stays out after a turn ends, so the outcome can be seen.
    private let afterTurn = 2.5
    /// How long a notice or problem stays out.
    private let afterProblem = 6.0

    init(trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        geometry = IslandController.currentGeometry()
        hosting = NSHostingView(rootView: IslandView(model: model))
        hosting.sizingOptions = [] // the controller sets the size; SwiftUI must not resize the window
        panel.contentView = hosting
        panel.setFrame(geometry.frame(presentation, visible: false), display: false)
    }

    func start() {
        let move: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        // Moves over other apps (global) and over the island itself (local).
        if let global = NSEvent.addGlobalMonitorForEvents(matching: move, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.evaluate() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: move, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.evaluate() }
            return event
        }) { monitors.append(local) }

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        })
        // After switching Spaces (including into a full-screen app), make sure the island is still in front.
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.spaceChanged() }
        })
    }

    func stop() {
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors = []
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observers = []
        recheck?.invalidate()
        panel.orderOut(nil)
    }

    // MARK: - Runtime

    func apply(_ status: RuntimeSupervisor.Status) {
        model.status.apply(status)
        statusChanged()
    }

    func apply(_ event: IslandEvent) {
        switch event {
        case .micLevel(let peak):
            // 20 updates a second: only the meter changes, and only while it is shown.
            if model.status.showsLevel { model.meter.add(peak) }
            return
        case .state(.listening):
            model.meter.reset()
        default:
            break
        }
        let wasBusy = model.status.isBusy
        model.status.apply(event)
        if case .state(.idle) = event, wasBusy {
            // A turn just ended: stay out briefly so the outcome is seen.
            linger(model.status.needsAttention ? afterProblem : afterTurn)
        }
        statusChanged()
    }

    /// Keeps the island out during a turn, and brings it out for a notice or problem.
    private func statusChanged() {
        if model.status.title != lastTitle {
            lastTitle = model.status.title
            trace("status \(model.status.title) — \(model.status.detail)")
            snapshotSoon()
        }
        let busy = model.status.isBusy
        if hover.held != busy {
            hover.held = busy
            trace("held \(busy)")
        }
        if model.status.needsAttention { linger(afterProblem) }
        evaluate()
    }

    private func linger(_ seconds: Double) {
        hover.linger(until: ProcessInfo.processInfo.systemUptime + seconds)
    }

    // MARK: - Pointer

    private func evaluate() {
        let point = NSEvent.mouseLocation
        let trigger = geometry.inTrigger(point)
        if trigger != lastTrigger {
            lastTrigger = trigger
            trace("trigger \(trigger) at \(point)")
        }
        let output = hover.update(
            inTrigger: trigger,
            inKeepZone: shown && geometry.inKeepZone(point, presentation),
            now: ProcessInfo.processInfo.systemUptime)
        setShown(output.visible)
        scheduleRecheck(at: output.recheckAt)
    }

    /// Re-evaluates when a delay ends even if the pointer has stopped moving (e.g. resting at the edge).
    private func scheduleRecheck(at time: Double?) {
        recheck?.invalidate()
        recheck = nil
        guard let time else { return }
        let delay = max(0, time - ProcessInfo.processInfo.systemUptime) + 0.005
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.evaluate() }
        }
        RunLoop.main.add(timer, forMode: .common)
        recheck = timer
    }

    // MARK: - Showing and hiding

    private func setShown(_ visible: Bool) {
        guard visible != shown else { return }
        shown = visible
        trace(visible ? "panel show" : "panel hide")
        let target = geometry.frame(presentation, visible: visible)
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

        if visible, !panel.isVisible {
            // Start from the hidden position (or in place, faded out, with Reduce Motion).
            panel.setFrame(reduceMotion ? target : geometry.frame(presentation, visible: false), display: false)
            panel.alphaValue = reduceMotion ? 0 : 1
            panel.orderFrontRegardless()
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = slideDuration
            context.timingFunction = visible
                ? CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1) // quick out, soft landing
                : CAMediaTimingFunction(name: .easeIn)
            if reduceMotion {
                panel.animator().alphaValue = visible ? 1 : 0
            } else {
                panel.animator().setFrame(target, display: true)
            }
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.shown else { return }
                // Fully hidden: take it off screen so it cannot catch clicks or appear on another display.
                self.panel.orderOut(nil)
                self.panel.alphaValue = 1
                self.model.status.acknowledge()
                self.model.meter.reset()
            }
        })
    }

    // MARK: - Development snapshots

    private func snapshotSoon() {
        guard snapshotDirectory != nil else { return }
        // Long enough for some mic levels to arrive while listening.
        let timer = Timer(timeInterval: 0.6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.writeSnapshot() }
        }
        RunLoop.main.add(timer, forMode: .common)
    }

    private func writeSnapshot() {
        guard let directory = snapshotDirectory else { return }
        let size = geometry.size(presentation)
        let renderer = ImageRenderer(content: IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        snapshotCount += 1
        let name = String(format: "%02d-%@.png", snapshotCount, model.status.title.replacingOccurrences(of: " ", with: "-"))
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? png.write(to: directory.appendingPathComponent(name))
    }

    // MARK: - Displays and Spaces

    private static func currentGeometry() -> IslandGeometry {
        // The first screen is always the one with the menu bar.
        guard let screen = NSScreen.screens.first else {
            return IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1440, height: 900))
        }
        return IslandGeometry(screen: screen.frame, menuBarBottom: menuBarBottom(of: screen))
    }

    /// The bottom of the menu bar. `visibleFrame` also excludes a Dock on the left or right, so only its top is used.
    private static func menuBarBottom(of screen: NSScreen) -> CGFloat {
        let fromVisible = screen.visibleFrame.maxY
        // A menu bar that hides itself: the visible frame reaches the top. Keep below where it appears.
        if fromVisible >= screen.frame.maxY {
            return screen.frame.maxY - max(NSStatusBar.system.thickness, screen.safeAreaInsets.top)
        }
        return fromVisible
    }

    private func screensChanged() {
        let next = IslandController.currentGeometry()
        guard next != geometry else { return }
        geometry = next
        trace("screens changed: \(next.screen) menuBarBottom=\(next.menuBarBottom)")
        panel.setFrame(next.frame(presentation, visible: shown), display: shown)
        evaluate()
    }

    private func spaceChanged() {
        trace("space changed shown=\(shown)")
        if shown { panel.orderFrontRegardless() }
    }
}
