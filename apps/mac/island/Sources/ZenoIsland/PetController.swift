import AppKit
import SwiftUI
import ZenoIslandCore

/// Wisp's home (ADR-042): a transparent, click-through strip along the bottom of the main screen, just above
/// the Dock. It never takes focus or clicks, joins every Space, and stays out of Mission Control and screenshots
/// of other windows' stacking. Shown only while the Pet setting is on.
@MainActor
final class PetController {
    /// Wisp's drawn size in points.
    static let size: CGFloat = 56
    /// The strip's height: Wisp plus room for the thinking dots and z's above it.
    private static let stripHeight: CGFloat = 84
    /// Keeps Wisp off the very edges of the screen.
    private static let margin: CGFloat = 24

    private let window: NSPanel
    private let state = PetState()
    private var observers: [NSObjectProtocol] = []
    private let trace: (String) -> Void

    init(trace: @escaping (String) -> Void = { _ in }) {
        self.trace = trace
        window = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: PetStage(state: state, size: Self.size))
    }

    var isShown: Bool { window.isVisible }

    /// Shows or hides Wisp; safe to call repeatedly.
    func setEnabled(_ enabled: Bool) {
        if enabled == window.isVisible { return }
        if enabled {
            place()
            window.orderFrontRegardless()
            state.running = true
            state.trace = trace
            if observers.isEmpty { observe() }
            trace("pet shown")
        } else {
            state.running = false
            window.orderOut(nil)
            trace("pet hidden")
        }
    }

    /// ZENO's state changed.
    func update(_ kind: IslandStatus.Kind) {
        state.brain.update(status: kind, at: PetState.now)
    }

    /// Something the user did (a shortcut, opening the island): wakes a napping Wisp.
    func poke() {
        state.brain.poke(at: PetState.now)
    }

    func stop() {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        setEnabled(false)
    }

    // MARK: - Private

    private func observe() {
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.place() }
        })
    }

    /// Fits the strip to the main screen's visible area, so it sits on top of the Dock (or the screen's
    /// bottom edge when the Dock is hidden or on the side).
    private func place() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        let frame = NSRect(x: visible.minX + Self.margin, y: visible.minY, width: max(visible.width - Self.margin * 2, Self.size), height: Self.stripHeight)
        window.setFrame(frame, display: true)
        state.brain.resize(width: Double(frame.width - Self.size))
        trace("pet placed \(Int(frame.minX)),\(Int(frame.minY)) \(Int(frame.width))×\(Int(frame.height))")
    }
}

/// The pet's moving state, observed by the SwiftUI stage.
@MainActor @Observable
final class PetState {
    /// Not observed: the timeline redraws every frame anyway, and stepping it inside a drawn frame must not
    /// schedule another one.
    @ObservationIgnored var brain = PetBrain(width: 800, now: PetState.now)
    /// Off: the timeline stops, so a hidden pet costs nothing.
    var running = false
    /// Development tracing: mood and position about once a second.
    @ObservationIgnored var trace: (String) -> Void = { _ in }
    @ObservationIgnored private var lastTrace = 0.0

    func step() -> PetBrain.Mood {
        let now = Self.now
        let mood = brain.step(to: now)
        if now - lastTrace >= 1 {
            lastTrace = now
            trace("pet \(mood) x=\(Int(brain.x)) facing=\(Int(brain.facing))")
        }
        return mood
    }

    static var now: Double { ProcessInfo.processInfo.systemUptime }
}

/// Draws Wisp at its place along the strip, advancing the brain every frame.
struct PetStage: View {
    let state: PetState
    let size: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !state.running)) { timeline in
            let now = timeline.date.timeIntervalSinceReferenceDate
            let mood = advance()
            ZStack(alignment: .bottomLeading) {
                Color.clear
                WispView(mood: mood, time: now, facing: state.brain.facing, size: size)
                    .offset(x: state.brain.x, y: 0)
            }
        }
    }

    /// Steps the brain to the current time. Done in the view so it runs exactly once per drawn frame.
    @MainActor private func advance() -> PetBrain.Mood {
        state.step()
    }
}
