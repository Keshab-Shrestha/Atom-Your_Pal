import AppKit
import SwiftUI
import ZenoIslandCore

/// What the approval card draws, written by `ApprovalController`.
@MainActor @Observable
final class ApprovalCardState {
    var request: ApprovalRequest?
    var visible = false
    var tailX: CGFloat = ApprovalController.size.width / 2
    var tailOnTop = false

    init(request: ApprovalRequest? = nil, visible: Bool = false, tailOnTop: Bool = false) {
        self.request = request
        self.visible = visible
        self.tailOnTop = tailOnTop
    }
}

/// Asks the user before ZENO does something risky on the Mac (ADR-054): what it will do, why it asks,
/// and Allow or Decline. It looks like Wisp's bubble and is held by Wisp, but it can be clicked.
struct ApprovalView: View {
    let state: ApprovalCardState
    let onAnswer: (Bool) -> Void
    var snapshot = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let amber = Color(red: 1.0, green: 0.80, blue: 0.35)

    var body: some View {
        let size = ApprovalController.size
        let tail = BubbleLayout.tailHeight
        let shape = BubbleShape(tailX: state.tailX, tailOnTop: state.tailOnTop)
        let request = state.request ?? ApprovalRequest(id: "", summary: "", reason: "")
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(Self.amber.opacity(0.22))
                    Image(systemName: "hand.raised.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(Self.amber)
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
                Text(request.reason.isEmpty ? " " : "Because \(request.reason)")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.62))
                    .lineLimit(2)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                button("Decline", primary: false) { onAnswer(false) }
                button("Allow", primary: true) { onAnswer(true) }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, (state.tailOnTop ? tail : 0) + 12)
        .padding(.bottom, (state.tailOnTop ? 0 : tail) + 12)
        .frame(width: size.width, height: size.height)
        .background {
            ZStack {
                if !snapshot { shape.fill(.ultraThinMaterial) }
                shape.fill(Color(white: 0.06).opacity(snapshot ? 0.96 : 0.9))
            }
        }
        .overlay { shape.stroke(Self.amber.opacity(0.45), lineWidth: 0.8) }
        .shadow(color: .black.opacity(snapshot ? 0 : 0.34), radius: 10, y: 3)
        .environment(\.colorScheme, .dark)
        .scaleEffect(state.visible || reduceMotion ? 1 : 0.72, anchor: UnitPoint(x: state.tailX / size.width, y: state.tailOnTop ? 0 : 1))
        .opacity(state.visible ? 1 : 0)
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.78), value: state.visible)
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .padding(ApprovalController.shadowInset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("ZENO needs your OK: \(request.summary)")
    }

    private func button(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(primary ? Color.black.opacity(0.85) : .white.opacity(0.9))
                .frame(maxWidth: .infinity, minHeight: 28)
                .background(primary ? Self.amber : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

/// The window that carries the approval card: it never takes focus, so the app being controlled keeps it.
/// Esc, handled by the shortcut engine, declines it as well.
@MainActor
final class ApprovalController {
    static let size = CGSize(width: 340, height: 158)
    static let shadowInset: CGFloat = 12

    let state = ApprovalCardState()
    /// The user clicked Allow (true) or Decline (false).
    var onAnswer: (Bool) -> Void = { _ in }
    private let panel: NSPanel
    private var feet = CGPoint.zero
    private var wispHeight: CGFloat = 54
    private var hiding: Task<Void, Never>?

    var isVisible: Bool { state.visible }

    init() {
        let size = CGSize(width: Self.size.width + 2 * Self.shadowInset, height: Self.size.height + 2 * Self.shadowInset)
        panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isFloatingPanel = true // before `level`: setting it resets the level
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2) // over Wisp and its bubble
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: ApprovalView(state: state, onAnswer: { _ in }))
        hosting.sizingOptions = []
        panel.contentView = hosting
        hosting.rootView = ApprovalView(state: state) { [weak self] approved in self?.onAnswer(approved) }
    }

    /// Shows the request over Wisp, who stands at `feet`.
    func show(_ request: ApprovalRequest, at feet: CGPoint, wispHeight: CGFloat) {
        hiding?.cancel()
        hiding = nil
        self.feet = feet
        self.wispHeight = wispHeight
        state.request = request
        reposition()
        if !panel.isVisible {
            state.visible = false
            panel.orderFrontRegardless()
        }
        if !state.visible { Task { @MainActor [state] in state.visible = true } }
    }

    func hide() {
        guard state.visible else { return }
        state.visible = false
        hiding?.cancel()
        hiding = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(380))
            guard let self, !Task.isCancelled, !self.state.visible else { return }
            self.panel.orderOut(nil)
            self.state.request = nil
        }
    }

    /// Wisp moved.
    func follow(_ feet: CGPoint) {
        self.feet = feet
        if panel.isVisible { reposition() }
    }

    func stop() {
        hiding?.cancel()
        state.visible = false
        panel.orderOut(nil)
    }

    private func reposition() {
        guard let bounds = BubbleController.displayBounds(containing: feet) else { return }
        let placement = BubbleLayout.place(feet: feet, bodyHeight: wispHeight, size: Self.size, in: bounds)
        let tailOnTop = placement.side == .below
        if state.tailX != placement.tailX { state.tailX = placement.tailX }
        if state.tailOnTop != tailOnTop { state.tailOnTop = tailOnTop }
        let frame = placement.frame.insetBy(dx: -Self.shadowInset, dy: -Self.shadowInset)
        if panel.frame != frame { panel.setFrame(frame, display: false) }
    }
}
