import AppKit
import SwiftUI
import ZenoIslandCore

/// Places the island on the display with the menu bar and slides it in and out as the pointer
/// reaches the top edge (ADR-036). Pointer tracking uses mouse-moved events, which need no permission.
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
    private let trace: (String) -> Void

    /// Slide duration; with Reduce Motion the panel fades instead.
    private let slideDuration = 0.22

    init(trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        geometry = IslandController.currentGeometry()
        hosting = NSHostingView(rootView: IslandView(model: model))
        hosting.sizingOptions = [] // the controller sets the size; SwiftUI must not resize the window
        panel.contentView = hosting
        model.topInset = geometry.topInset
        panel.setFrame(geometry.frame(presentation, visible: false), display: false)
    }

    func start() {
        let move: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
        // Moves over other apps (global) and over the island itself (local).
        if let global = NSEvent.addGlobalMonitorForEvents(matching: move, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.pointerMoved() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: move, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.pointerMoved() }
            return event
        }) { monitors.append(local) }

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        })
        // After switching Spaces (including into a full-screen app), make sure the panel is still in front.
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

    func apply(_ status: RuntimeSupervisor.Status) { model.status.apply(status) }
    func apply(_ event: IslandEvent) { model.status.apply(event) }

    // MARK: - Pointer

    private func pointerMoved() {
        evaluate()
    }

    private func evaluate() {
        let point = NSEvent.mouseLocation
        let output = hover.update(
            inTrigger: geometry.inTrigger(point),
            inKeepZone: geometry.inKeepZone(point, presentation),
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

        if visible {
            if !panel.isVisible {
                // Start from the hidden position (or in place, faded out, with Reduce Motion).
                panel.setFrame(reduceMotion ? target : geometry.frame(presentation, visible: false), display: false)
                panel.alphaValue = reduceMotion ? 0 : 1
                panel.orderFrontRegardless()
            }
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = slideDuration
            context.timingFunction = CAMediaTimingFunction(name: visible ? .easeOut : .easeIn)
            if reduceMotion {
                panel.animator().alphaValue = visible ? 1 : 0
            } else {
                panel.animator().setFrame(target, display: true)
            }
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.trace("slide done shown=\(self.shown) visible=\(self.panel.isVisible) activeSpace=\(self.panel.isOnActiveSpace) occluded=\(!self.panel.occlusionState.contains(.visible)) frame=\(self.panel.frame)")
                guard !self.shown else { return }
                // Fully hidden: take it off screen so it cannot catch clicks or appear on another display.
                self.panel.orderOut(nil)
                self.panel.alphaValue = 1
            }
        })
    }

    // MARK: - Displays and Spaces

    private static func currentGeometry() -> IslandGeometry {
        // The first screen is always the one with the menu bar.
        guard let screen = NSScreen.screens.first else {
            return IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1440, height: 900))
        }
        return IslandGeometry(screen: screen.frame, topInset: screen.safeAreaInsets.top)
    }

    private func screensChanged() {
        let next = IslandController.currentGeometry()
        guard next != geometry else { return }
        geometry = next
        model.topInset = next.topInset
        trace("screens changed: \(next.screen)")
        panel.setFrame(next.frame(presentation, visible: shown), display: shown)
        evaluate()
    }

    private func spaceChanged() {
        trace("space changed shown=\(shown)")
        if shown { panel.orderFrontRegardless() }
    }
}
