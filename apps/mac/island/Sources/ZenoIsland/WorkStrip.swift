import AppKit
import SwiftUI
import ZenoIslandCore

// ADR-056: ZENO's fixed homes. The menu-bar icon opens the panel; the work strip above the Dock shows what ZENO is
// doing on the Mac and asks before risky actions; a short label sits beside Wisp while it points.

// MARK: - Menu-bar icon

/// ZENO's menu-bar icon: Wisp's silhouette, lit by ZENO's state. A click opens or closes the panel;
/// right-click (or Control-click) shows Open ZENO, Helpers…, Show Wisp and Quit ZENO.
@MainActor
final class MenuBarIcon: NSObject {
    var onClick: () -> Void = {}
    var onShowWisp: (Bool) -> Void = { _ in }
    var onHelpers: () -> Void = {}
    var isWispShown: () -> Bool = { false }
    private let item: NSStatusItem
    private var kind: IslandStatus.Kind?

    override init() {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        item.autosaveName = "dev.zeno.island.menu"
        if let button = item.button {
            button.target = self
            button.action = #selector(clicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.setAccessibilityLabel("ZENO")
            button.toolTip = "ZENO"
        }
        update(.starting, title: "Starting")
    }

    /// Shows ZENO's state on Wisp's glyph (ADR-084): plain (template) most of the time, Wisp's light while
    /// listening, amber when Wisp needs you, coral on a problem.
    func update(_ kind: IslandStatus.Kind, title: String) {
        item.button?.setAccessibilityValue(title)
        guard kind != self.kind else { return }
        self.kind = kind
        item.button?.image = MenuBarGlyph.image(MenuBarLight(kind), description: "ZENO: \(title)")
    }

    /// Where the panel hangs from: the icon's display and centre. Nil when the icon is not on screen (hidden by the notch).
    var anchor: (screen: NSScreen, midX: CGFloat)? {
        guard let window = item.button?.window, let screen = window.screen, window.frame.width > 0 else { return nil }
        return (screen, window.frame.midX)
    }

    /// The icon looks pressed while the panel is open, like other menu-bar items.
    func setHighlighted(_ on: Bool) {
        item.button?.highlight(on)
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
        let open = NSMenuItem(title: "Open ZENO", action: #selector(openPanel), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let helpers = NSMenuItem(title: "Helpers…", action: #selector(openHelpers), keyEquivalent: "")
        helpers.target = self
        menu.addItem(helpers)
        let wisp = NSMenuItem(title: "Show Wisp", action: #selector(toggleWisp), keyEquivalent: "")
        wisp.target = self
        wisp.state = isWispShown() ? .on : .off
        menu.addItem(wisp)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit ZENO", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        // Attached only for this click, so a left click still opens the panel.
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    @objc private func openPanel() { onClick() }
    @objc private func openHelpers() { onHelpers() }
    @objc private func toggleWisp() { onShowWisp(!isWispShown()) }
    @objc private func quit() { NSApp.terminate(nil) }
}

// MARK: - Work strip

/// The strip's content: what ZENO is doing and Stop, or — while a request waits — what it wants to do, why, and
/// Decline / Allow.
struct WorkStripView: View {
    let model: IslandModel
    var snapshot = false

    static let cornerRadius: CGFloat = 16

    var body: some View {
        let asking = model.approval.pending != nil
        let palette = model.settings.theme.palette
        let shape = RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
        ZStack(alignment: .topLeading) {
            if let request = model.approval.pending {
                AskingView(request: request) { model.answerApproval($0) }
                    .transition(.opacity)
            } else {
                StepRow(model: model).transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background { SurfaceBackground(shape: shape, glass: !snapshot) }
        .overlay {
            // Asking: a quiet attention edge, not a glow.
            if asking { shape.strokeBorder(palette.attention.color.opacity(0.55), lineWidth: 1) }
        }
        .clipShape(shape)
        .shadow(color: .black.opacity(snapshot ? 0 : (palette.isDark ? 0.32 : 0.16)), radius: 10, y: 3)
        .themed(palette)
        .animation(.easeOut(duration: 0.18), value: asking)
        .padding(WorkStripController.shadowInset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(asking ? "ZENO needs your OK" : "ZENO: \(model.work.line)")
    }

}

/// What ZENO is doing, and Stop. Its own view so it reads the theme set on the strip.
private struct StepRow: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            WorkGlyph(outcome: model.work.outcome)
                .frame(width: 26, height: 26)
            Text(model.work.line)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text.color)
                .lineLimit(1)
                .truncationMode(.tail)
                .contentTransition(.opacity)
                .animation(.easeOut(duration: 0.18), value: model.work.line)
            Spacer(minLength: 6)
            if model.work.outcome == .working {
                Button { model.stopWork() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "stop.fill").font(.system(size: 9, weight: .bold))
                        Text("Stop").font(.system(size: 12, weight: .semibold))
                        KeyHint(text: "esc")
                    }
                    .foregroundStyle(theme.text.color)
                    .padding(.leading, 10).padding(.trailing, 6)
                    .frame(height: 26)
                    .background(Capsule().fill(theme.fill2.color))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop")
                .accessibilityHint("Stops what ZENO is doing on your Mac")
            }
        }
        .padding(.horizontal, 10)
        .frame(maxHeight: .infinity)
    }
}

/// The approval part of the strip (ADR-054, ADR-056).
private struct AskingView: View {
    let request: ApprovalRequest
    let onAnswer: (Bool) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(theme.attention.color.opacity(theme.isDark ? 0.2 : 0.14))
                    Image(systemName: "hand.raised.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.attention.color)
                }
                .frame(width: 24, height: 24)
                Text("ZENO needs your OK")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text2.color)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(request.summary)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.text.color)
                    .lineLimit(2)
                if !request.reason.isEmpty {
                    Text("Because \(request.reason)")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.text2.color)
                        .lineLimit(1)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                button("Decline", hint: "esc", primary: false) { onAnswer(false) }
                button("Allow", hint: nil, primary: true) { onAnswer(true) }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func button(_ title: String, hint: String?, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 12.5, weight: .semibold))
                if let hint {
                    Text(hint).font(.system(size: 10, weight: .semibold, design: .rounded)).opacity(primary ? 0.7 : 0.55)
                }
            }
            .foregroundStyle(primary ? theme.onAttention.color : theme.text.color)
            .frame(width: 112, height: 28)
            .background(primary ? theme.attention.color : theme.fill2.color, in: RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

/// The strip's badge: working (pulsing), done, stopped or failed.
struct WorkGlyph: View {
    let outcome: WorkStripState.Outcome
    @Environment(\.theme) private var theme

    var body: some View {
        let (symbol, tint): (String, Color) = switch outcome {
        case .working: ("cursorarrow.motionlines", theme.tint(.acting))
        case .done: ("checkmark", theme.success.color)
        case .stopped: ("stop.fill", theme.text2.color)
        case .failed: ("exclamationmark.triangle.fill", theme.problem.color)
        }
        ZStack {
            Circle().fill(tint.opacity(theme.isDark ? 0.2 : 0.14))
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.pulse, options: .repeating, isActive: outcome == .working)
        }
        .animation(.easeOut(duration: 0.2), value: outcome)
        .accessibilityHidden(true)
    }
}

/// The strip's window: bottom centre of the main display, above the Dock and Wisp's walkway. It can be clicked
/// but never takes focus, so the app ZENO is working in keeps it.
@MainActor
final class WorkStripController {
    static let shadowInset: CGFloat = 12

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
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2) // over Wisp
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
    ///   - clearance: room kept free above the Dock for Wisp.
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

/// The short label beside Wisp while it points (ADR-056): what the place is, nothing more.
struct PointLabelView: View {
    let text: String
    var palette = ThemePalette.lantern
    var snapshot = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(palette.accentFill).frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(palette.text.color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { SurfaceBackground(shape: Capsule(), glass: !snapshot) }
        .shadow(color: .black.opacity(snapshot ? 0 : (palette.isDark ? 0.3 : 0.14)), radius: 6, y: 2)
        .themed(palette)
        .padding(PointLabelController.shadowInset)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ZENO is pointing at \(text)")
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
    private var wispHeight: CGFloat = 54
    private var wispHalfWidth: CGFloat = 22
    private(set) var isVisible = false

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 40), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true // it only shows; clicks reach what is under it
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1) // over Wisp
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        hosting = NSHostingView(rootView: PointLabelView(text: ""))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    func show(_ text: String, palette: ThemePalette, feet: CGPoint, wispHeight: CGFloat, wispHalfWidth: CGFloat) {
        self.text = text
        self.feet = feet
        self.wispHeight = wispHeight
        self.wispHalfWidth = wispHalfWidth
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

    /// Wisp moved.
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
        let frame = PointLabelLayout.frame(feet: feet, wispHeight: wispHeight, wispHalfWidth: wispHalfWidth,
                                           width: ceil(measured), in: bounds)
            .insetBy(dx: -Self.shadowInset, dy: -Self.shadowInset)
        if panel.frame != frame { panel.setFrame(frame, display: true) }
    }
}
