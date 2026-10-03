import AppKit
import SwiftUI
import ZenoIslandCore

// ADR-056: ZENO's fixed homes. The menu-bar icon opens the panel; the work strip above the Dock shows what ZENO is
// doing on the Mac and asks before risky actions; a short label sits beside Wisp while it points.

// MARK: - Menu-bar icon

/// ZENO's menu-bar icon: its symbol and colour follow ZENO's state. A click opens or closes the panel;
/// right-click (or Control-click) shows Open ZENO, Show Wisp and Quit ZENO.
@MainActor
final class MenuBarIcon: NSObject {
    var onClick: () -> Void = {}
    var onShowWisp: (Bool) -> Void = { _ in }
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

    /// Shows ZENO's state. Quiet states use a plain (template) symbol like other menu-bar icons; states that need
    /// the user's eye (listening, asking, a problem) are coloured.
    func update(_ kind: IslandStatus.Kind, title: String) {
        item.button?.setAccessibilityValue(title)
        guard kind != self.kind else { return }
        self.kind = kind
        let base = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
        guard let symbol = NSImage(systemSymbolName: StateGlyph.symbol(kind), accessibilityDescription: "ZENO: \(title)") else { return }
        let image: NSImage
        switch kind {
        case .listening, .asking, .problem, .notice, .acting:
            let colour = NSImage.SymbolConfiguration(paletteColors: [NSColor(StateGlyph.tint(kind))])
            image = symbol.withSymbolConfiguration(base.applying(colour)) ?? symbol
            image.isTemplate = false
        default:
            image = symbol.withSymbolConfiguration(base) ?? symbol
            image.isTemplate = true
        }
        item.button?.image = image
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
    @objc private func toggleWisp() { onShowWisp(!isWispShown()) }
    @objc private func quit() { NSApp.terminate(nil) }
}

// MARK: - Work strip

/// The strip's content: what ZENO is doing and Stop, or — while a request waits — what it wants to do, why, and
/// Decline / Allow.
struct WorkStripView: View {
    let model: IslandModel
    var snapshot = false

    static let amber = Color(red: 1.0, green: 0.80, blue: 0.35)
    static let cornerRadius: CGFloat = 16

    var body: some View {
        let asking = model.approval.pending != nil
        ZStack(alignment: .topLeading) {
            if let request = model.approval.pending {
                AskingView(request: request) { model.answerApproval($0) }
                    .transition(.opacity)
            } else {
                stepRow.transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            ZStack {
                if !snapshot { RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous).fill(.ultraThinMaterial) }
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous).fill(Color(white: 0.06).opacity(snapshot ? 0.96 : 0.86))
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .strokeBorder(asking ? Self.amber.opacity(0.5) : .white.opacity(0.14), lineWidth: asking ? 0.8 : 0.5)
        }
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(snapshot ? 0 : 0.32), radius: 10, y: 3)
        .environment(\.colorScheme, .dark)
        .animation(.easeOut(duration: 0.18), value: asking)
        .padding(WorkStripController.shadowInset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(asking ? "ZENO needs your OK" : "ZENO: \(model.work.line)")
    }

    private var stepRow: some View {
        HStack(spacing: 10) {
            WorkGlyph(outcome: model.work.outcome)
                .frame(width: 26, height: 26)
            Text(model.work.line)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .truncationMode(.tail)
                .contentTransition(.opacity)
                .animation(.easeOut(duration: 0.18), value: model.work.line)
            Spacer(minLength: 6)
            if model.work.outcome == .working {
                Button { model.stopWork() } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "stop.fill").font(.system(size: 9, weight: .bold))
                        Text("Stop").font(.system(size: 12, weight: .semibold))
                        Text("esc").font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.45))
                    }
                    .foregroundStyle(.white.opacity(0.92))
                    .padding(.horizontal, 10)
                    .frame(height: 26)
                    .background(Capsule().fill(.white.opacity(0.12)))
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(WorkStripView.amber.opacity(0.22))
                    Image(systemName: "hand.raised.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(WorkStripView.amber)
                }
                .frame(width: 24, height: 24)
                Text("ZENO needs your OK")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(request.summary)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                if !request.reason.isEmpty {
                    Text("Because \(request.reason)")
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.62))
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
            HStack(spacing: 5) {
                Text(title).font(.system(size: 12.5, weight: .semibold))
                if let hint { Text(hint).font(.system(size: 10, weight: .medium)).opacity(0.5) }
            }
            .foregroundStyle(primary ? Color.black.opacity(0.85) : .white.opacity(0.9))
            .frame(width: 104, height: 28)
            .background(primary ? WorkStripView.amber : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

/// The strip's badge: working (pulsing), done, stopped or failed.
struct WorkGlyph: View {
    let outcome: WorkStripState.Outcome

    var body: some View {
        let (symbol, tint): (String, Color) = switch outcome {
        case .working: ("cursorarrow.motionlines", StateGlyph.tint(.acting))
        case .done: ("checkmark", StateGlyph.tint(.ready))
        case .stopped: ("stop.fill", Color(white: 0.75))
        case .failed: ("exclamationmark.triangle.fill", StateGlyph.tint(.problem))
        }
        ZStack {
            Circle().fill(tint.opacity(0.22))
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
    var snapshot = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(StateGlyph.tint(.acting)).frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                if !snapshot { Capsule().fill(.ultraThinMaterial) }
                Capsule().fill(Color(white: 0.06).opacity(snapshot ? 0.95 : 0.84))
            }
        }
        .overlay { Capsule().strokeBorder(.white.opacity(0.16), lineWidth: 0.5) }
        .shadow(color: .black.opacity(snapshot ? 0 : 0.3), radius: 6, y: 2)
        .environment(\.colorScheme, .dark)
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

    func show(_ text: String, feet: CGPoint, wispHeight: CGFloat, wispHalfWidth: CGFloat) {
        self.text = text
        self.feet = feet
        self.wispHeight = wispHeight
        self.wispHalfWidth = wispHalfWidth
        hosting.rootView = PointLabelView(text: text)
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
