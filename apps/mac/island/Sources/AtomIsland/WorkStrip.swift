import AppKit
import SwiftUI
import AtomIslandCore

// ADR-056: ATOM's fixed homes. The menu-bar icon opens the panel; the work strip above the Dock shows what ATOM is
// doing on the Mac and asks before risky actions; a short label sits beside Pal while it points.

// MARK: - Menu-bar icon

/// ATOM's menu-bar icon: Pal's silhouette, lit by ATOM's state. A click opens or closes the panel;
/// right-click (or Control-click) shows Open ATOM, Helpers…, Show Pal and Quit ATOM.
@MainActor
final class MenuBarIcon: NSObject {
    var onClick: () -> Void = {}
    var onShowPal: (Bool) -> Void = { _ in }
    var onHelpers: () -> Void = {}
    var isPalShown: () -> Bool = { false }
    private let item: NSStatusItem
    private var kind: IslandStatus.Kind?
    private var flat = false

    override init() {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        item.autosaveName = "dev.atom.island.menu"
        if let button = item.button {
            button.target = self
            button.action = #selector(clicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.setAccessibilityLabel("ATOM")
            button.toolTip = "ATOM"
        }
        update(.starting, title: "Starting")
    }

    /// Shows what ATOM is doing on Pal's glyph (ADR-084): plain (template) most of the time, Pal's light while
    /// listening, amber when Pal needs you, coral on a problem.
    /// `flat`: Void's flat colours, no glow (ADR-086).
    func update(_ kind: IslandStatus.Kind, title: String, flat: Bool = false) {
        item.button?.setAccessibilityValue(title)
        guard kind != self.kind || flat != self.flat else { return }
        self.kind = kind
        self.flat = flat
        item.button?.image = MenuBarGlyph.image(MenuBarLight(kind), flat: flat, description: "ATOM: \(title)")
    }

    /// Where the panel hangs from: the icon's display and centre. Nil when the icon is not on screen (hidden by the notch).
    var anchor: (screen: NSScreen, midX: CGFloat)? {
        guard let window = item.button?.window, let screen = window.screen, window.frame.width > 0 else { return nil }
        return (screen, window.frame.midX)
    }

    func remove() {
        NSStatusBar.system.removeStatusItem(item)
    }

    @objc private func clicked() {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else {
            onClick()
        }
    }

    private func showMenu() {
        let menu = NSMenu()
        let open = NSMenuItem(title: "Open ATOM", action: #selector(openPanel), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let helpers = NSMenuItem(title: "Open ATOM…", action: #selector(openHelpers), keyEquivalent: "")
        helpers.target = self
        menu.addItem(helpers)
        let pal = NSMenuItem(title: "Show ATOM", action: #selector(togglePal), keyEquivalent: "")
        pal.target = self
        pal.state = isPalShown() ? .on : .off
        menu.addItem(pal)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit ATOM", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        // Attached only for this click, so a left click still opens the panel.
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    @objc private func openPanel() { onClick() }
    @objc private func openHelpers() { onHelpers() }
    @objc private func togglePal() { onShowPal(!isPalShown()) }
    @objc private func quit() { NSApp.terminate(nil) }
}

// MARK: - Work strip

/// The strip's content: what ATOM is doing and Stop, or — while a request waits — what it wants to do, why, and
/// Decline / Allow. Lantern's night glass (ADR-084); asking turns it to the amber family, with Allow the one fill.
struct WorkStripView: View {
    let model: IslandModel
    var snapshot = false

    /// The working strip is a capsule (its height 44 / 2): Stop, 28 tall and 8 from the edge, is concentric with it.
    static let cornerRadius: CGFloat = WorkStripLayout.size.height / 2
    /// Asking: the panel's radius. Decline and Allow sit `Spacing.composer` from the edges, concentric with it.
    static let askingRadius: CGFloat = 26

    var body: some View {
        let asking = model.approval.pending != nil
        let palette = model.settings.theme.palette
        // Void asks on the panel's own radius (24), its buttons 16 at the 8 pt corner gap (ADR-086).
        let askingRadius = palette.isFlat ? palette.radiusSurface : Self.askingRadius
        let shape = RoundedRectangle(cornerRadius: asking ? askingRadius : Self.cornerRadius, style: .continuous)
        ZStack(alignment: .topLeading) {
            if let request = model.approval.pending {
                AskingView(request: request, onReview: { model.openFileReview() }) { approved, remember in model.answerApproval(approved, rememberFile: remember) }
                    .transition(.opacity)
            } else {
                StepRow(model: model).transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            ZStack {
                SurfaceBackground(shape: shape, glass: !snapshot)
                if asking, palette.usesGlow {
                    // Amber, because it needs you: a little warmth from the top corner and an amber rim.
                    shape.fill(RadialGradient(colors: [palette.attention.color.opacity(palette.isDark ? 0.13 : 0.10), .clear],
                                              center: .topLeading, startRadius: 0, endRadius: 240))
                    shape.strokeBorder(palette.attention.color.opacity(0.4), lineWidth: 0.8)
                }
            }
        }
        .clipShape(shape)
        .shadow(color: .black.opacity(palette.usesShadows ? (palette.isDark ? 0.3 : 0.12) : 0), radius: 2, y: 1)
        .shadow(color: .black.opacity(palette.usesShadows ? (palette.isDark ? 0.36 : 0.14) : 0), radius: 12, y: 7)
        .themed(palette)
        .environment(\.islandSnapshot, snapshot)
        .animation(.easeOut(duration: 0.18), value: asking)
        .padding(WorkStripController.shadowInset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(asking ? "ATOM needs your OK" : "ATOM: \(model.work.line)")
    }

}

/// What ATOM is doing, and Stop. Its own view so it reads the theme set on the strip.
private struct StepRow: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 11) {
            WorkGlyph(outcome: model.work.outcome)
                .frame(width: 14, height: 14)
            Text(model.work.line)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.text.color)
                .lineLimit(1)
                .truncationMode(.tail)
                .contentTransition(.opacity)
                .animation(.easeOut(duration: 0.18), value: model.work.line)
            Spacer(minLength: 6)
            // ADR-111: a work plan that goes on shows one dot a portion.
            if let plan = model.helpers.list?.activePlan { PlanDots(plan: plan) }
            if model.work.outcome == .working {
                Button { model.stopWork() } label: {
                    HStack(spacing: 6) {
                        Text("Stop").font(.system(size: 12, weight: .medium))
                        KeyHint(text: "esc")
                    }
                    .foregroundStyle(theme.text.color)
                    .padding(.horizontal, 14)
                    .frame(height: 28)
                    .background(ControlFill(Capsule(), fill: theme.fill2.color))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop")
                .accessibilityHint("Stops what ATOM is doing on your Mac")
            }
        }
        .padding(.leading, 18)
        .padding(.trailing, (WorkStripLayout.size.height - 28) / 2)
        .frame(maxHeight: .infinity)
    }
}

/// The approval part of the strip (ADR-054, ADR-056).
private struct AskingView: View {
    let request: ApprovalRequest
    let onReview: () -> Void
    let onAnswer: (Bool, Bool) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Circle().fill(theme.attention.color).frame(width: 7, height: 7)
                        .shadow(color: theme.attention.color.opacity(theme.usesGlow ? 0.8 : 0), radius: 4)
                    Text("ATOM needs your OK")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(theme.statusDots ? theme.text2.color : theme.attention.color) // Void: colour only on the dot
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.summary)
                        .font(.system(size: 16, weight: .semibold, design: theme.titleDesign))
                        .foregroundStyle(theme.text.color)
                        .lineLimit(2)
                    if !request.reason.isEmpty {
                        Text(request.fileReview != nil ? request.reason : "Because \(request.reason)")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.text2.color)
                            .lineLimit(1)
                    }
                    if request.rememberFile && request.fileReview == nil {
                        Text("This file only. Chat access lasts until you revoke it.")
                            .font(.system(size: 11))
                            .foregroundStyle(theme.text2.color)
                            .lineLimit(1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            Spacer(minLength: 8)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button { onAnswer(false, false) } label: {
                    HStack(spacing: 6) {
                        Text("Decline").font(.system(size: 12.5, weight: .medium))
                        KeyHint(text: "esc")
                    }
                    .foregroundStyle(theme.text.color)
                    .padding(.horizontal, 18)
                    .frame(minWidth: 104, minHeight: 32)
                    .background(ControlFill(Capsule(), fill: theme.fill2.color))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Decline")
                if request.rememberFile && request.fileReview == nil {
                    Button("Allow for chat") { onAnswer(true, true) }
                        .buttonStyle(.plain)
                        .foregroundStyle(theme.attention.color)
                        .help("Allow future edits to this file in this chat, including after a restart. Say ‘Forget file permissions for this chat’ to revoke.")
                        .accessibilityLabel("Allow this file for this chat")
                }
                Button { if request.fileReview != nil { onReview() } else { onAnswer(true, false) } } label: {
                    // Void: a ghost button with an amber hairline and label (ADR-086); elsewhere the one fill.
                    Text(request.fileReview != nil ? "Review changes…" : request.rememberFile ? "Allow for task" : "Allow").font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(theme.isGhost ? theme.attention.color : theme.onAttention.color)
                        .padding(.horizontal, 24)
                        .frame(minWidth: 104, minHeight: 32)
                        .background(ControlFill(Capsule(), fill: theme.attention.color, tint: theme.attention.color))
                        .shadow(color: theme.attention.color.opacity(theme.usesGlow ? (theme.isDark ? 0.45 : 0.25) : 0), radius: 8)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(request.fileReview != nil ? "Review file changes in ATOM" : request.rememberFile ? "Allow for this task" : "Allow")
            }
            .padding(theme.cornerGap)
        }
    }
}

/// The strip's mark: Pal's light while working, a check when done, a small square when stopped, coral when it
/// failed. No icon circle: the light itself says it is live.
struct WorkGlyph: View {
    let outcome: WorkStripState.Outcome
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            if theme.statusDots, outcome != .working {
                // Void: done, stopped and failed are dots too: green, grey, red.
                StatusDot(color: outcome == .done ? theme.success.color : (outcome == .failed ? theme.problem.color : theme.text3.color))
            } else {
                lanternGlyph
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity)
        .animation(.easeOut(duration: 0.2), value: outcome)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var lanternGlyph: some View {
        switch outcome {
        case .working: WorkingLight(color: theme.live.color)
        case .done: Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(theme.success.color)
        case .stopped: RoundedRectangle(cornerRadius: 1.5, style: .continuous).fill(theme.text3.color).frame(width: 7, height: 7)
        case .failed: Circle().fill(theme.problem.color).frame(width: 7, height: 7).shadow(color: theme.problem.color.opacity(0.7), radius: 3.5)
        }
    }
}

/// A dot of Pal's light that breathes while ATOM works (`Motion.breathe`); still with Reduce Motion and in snapshots.
private struct WorkingLight: View {
    let color: Color
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let breathe = snapshot ? nil : Motion.breathe(reduceMotion)
        // Void keeps the breath (it says ATOM is working) but drops the glow around the dot.
        PhaseAnimator(breathe == nil ? [1.0] : [1.0, 0.45]) { glow in
            Circle().fill(color).frame(width: 7, height: 7)
                .shadow(color: color.opacity(theme.usesGlow ? 0.9 * glow : 0), radius: 2 + 4 * glow)
                .opacity(0.7 + 0.3 * glow)
        } animation: { _ in breathe }
    }
}

/// The strip's window: bottom centre of the main display, above the Dock and Pal's walkway. It can be clicked
/// but never takes focus, so the app ATOM is working in keeps it.
@MainActor
final class WorkStripController {
    /// Room around the strip for its shadow.
    static let shadowInset: CGFloat = 20

    private let panel: NSPanel
    private var visible = false
    private var asking = false
    private var hiding: Task<Void, Never>?

    init(model: IslandModel) {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 60), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isFloatingPanel = true // before `level`: setting it resets the level
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2) // over Pal
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let hosting = NSHostingView(rootView: WorkStripView(model: model))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    var isVisible: Bool { visible }
    /// The strip's frame on screen (without its shadow room), for development traces.
    var frame: CGRect { panel.frame.insetBy(dx: Self.shadowInset, dy: Self.shadowInset) }

    /// - Parameters:
    ///   - show: the strip should be up.
    ///   - asking: an approval request is waiting: the strip is taller.
    ///   - clearance: room kept free above the Dock for Pal.
    func update(show: Bool, asking: Bool, clearance: CGFloat) {
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if show {
            hiding?.cancel()
            hiding = nil
            let target = Self.frame(asking: asking, clearance: clearance)
            if !visible {
                visible = true
                self.asking = asking
                panel.setFrame(reduceMotion ? target : target.offsetBy(dx: 0, dy: -10), display: false)
                panel.alphaValue = 0
                panel.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = reduceMotion ? 0.12 : 0.24
                    context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                    if !reduceMotion { panel.animator().setFrame(target, display: true) }
                    panel.animator().alphaValue = 1
                }
            } else if asking != self.asking || panel.frame != target {
                self.asking = asking
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = reduceMotion ? 0 : 0.22
                    context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                    panel.animator().setFrame(target, display: true)
                }
            }
        } else if visible {
            visible = false
            let start = panel.frame
            NSAnimationContext.runAnimationGroup { context in
                context.duration = reduceMotion ? 0.1 : 0.2
                context.timingFunction = CAMediaTimingFunction(name: .easeIn)
                if !reduceMotion { panel.animator().setFrame(start.offsetBy(dx: 0, dy: -8), display: true) }
                panel.animator().alphaValue = 0
            }
            hiding = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(240))
                guard let self, !Task.isCancelled, !self.visible else { return }
                self.panel.orderOut(nil)
            }
        }
    }

    /// After a Space change: back in front.
    func bringToFront() {
        if visible { panel.orderFrontRegardless() }
    }

    func stop() {
        hiding?.cancel()
        visible = false
        panel.orderOut(nil)
    }

    private static func frame(asking: Bool, clearance: CGFloat) -> CGRect {
        let visible = NSScreen.screens.first?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let size = asking ? WorkStripLayout.askingSize : WorkStripLayout.size
        return WorkStripLayout.frame(size: size, visible: visible, clearance: clearance)
            .insetBy(dx: -shadowInset, dy: -shadowInset)
    }
}

// MARK: - Point label

/// The short label beside Pal while it points (ADR-056): what the place is, nothing more.
struct PointLabelView: View {
    let text: String
    var palette = ThemePalette.lantern
    var snapshot = false

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(palette.live.color).frame(width: 6, height: 6)
                .shadow(color: palette.live.color.opacity(palette.usesGlow ? 0.8 : 0), radius: 3)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(palette.text.color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 11)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { SurfaceBackground(shape: Capsule(), glass: !snapshot) }
        .shadow(color: .black.opacity(palette.usesShadows ? (palette.isDark ? 0.34 : 0.14) : 0), radius: 6, y: 3)
        .themed(palette)
        .padding(PointLabelController.shadowInset)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ATOM is pointing at \(text)")
    }
}

@MainActor
final class PointLabelController {
    static let shadowInset: CGFloat = 8
    private static let font = NSFont.systemFont(ofSize: 12, weight: .semibold)

    private let panel: NSPanel
    private let hosting: NSHostingView<PointLabelView>
    private var text = ""
    private var feet = CGPoint.zero
    private var palHeight: CGFloat = 54
    private var palHalfWidth: CGFloat = 22
    private(set) var isVisible = false

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 40), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true // it only shows; clicks reach what is under it
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1) // over Pal
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        hosting = NSHostingView(rootView: PointLabelView(text: ""))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    func show(_ text: String, palette: ThemePalette, feet: CGPoint, palHeight: CGFloat, palHalfWidth: CGFloat) {
        self.text = text
        self.feet = feet
        self.palHeight = palHeight
        self.palHalfWidth = palHalfWidth
        hosting.rootView = PointLabelView(text: text, palette: palette)
        reposition()
        guard !isVisible else { return }
        isVisible = true
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            panel.animator().alphaValue = 1
        }
    }

    /// Pal moved.
    func follow(_ feet: CGPoint) {
        self.feet = feet
        if isVisible { reposition() }
    }

    func hide() {
        guard isVisible else { return }
        isVisible = false
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.15
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, !self.isVisible else { return }
                self.panel.orderOut(nil)
            }
        })
    }

    func stop() {
        isVisible = false
        panel.orderOut(nil)
    }

    private func reposition() {
        guard let bounds = BubbleController.displayBounds(containing: feet) else { return }
        let measured = (text as NSString).size(withAttributes: [.font: Self.font]).width + 32
        let frame = PointLabelLayout.frame(feet: feet, palHeight: palHeight, palHalfWidth: palHalfWidth,
                                           width: ceil(measured), in: bounds)
            .insetBy(dx: -Self.shadowInset, dy: -Self.shadowInset)
        if panel.frame != frame { panel.setFrame(frame, display: true) }
    }
}
