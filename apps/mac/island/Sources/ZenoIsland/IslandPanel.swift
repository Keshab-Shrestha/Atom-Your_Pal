import AppKit
import SwiftUI
import ZenoIslandCore

/// The island window: borderless, never takes keyboard focus, above the menu bar, on every Space and
/// over full-screen apps. It is positioned by `IslandController`; it does not move itself.
final class IslandPanel: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isFloatingPanel = true // must come before `level`: setting it resets the level to .floating
        // Above the menu bar, so the island covers it at the top-centre.
        level = IslandPanel.islandLevel
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovable = false
        isReleasedWhenClosed = false
        animationBehavior = .none
        setAccessibilityRole(.popover)
        setAccessibilityLabel("ZENO")
    }

    static let islandLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 2)

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    /// The hidden position is above the top of the display; do not let AppKit pull it back on screen.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// What the pill shows. Observed by `IslandView`.
@MainActor @Observable
final class IslandModel {
    var status = IslandStatus()
    /// Extra space at the top for a camera housing, so content sits below it.
    var topInset: CGFloat = 0
}

/// Placeholder content for Task 0.5.4: a black pill hanging from the top edge with a status dot and
/// one line of text. The live level, transcript and conversation arrive in Tasks 0.5.6–0.5.7.
struct IslandView: View {
    let model: IslandModel

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)
                .shadow(color: dotColor.opacity(0.7), radius: 3)
            Text(model.status.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.top, model.topInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            UnevenRoundedRectangle(bottomLeadingRadius: 16, bottomTrailingRadius: 16, style: .continuous)
                .fill(.black)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("ZENO: \(model.status.label)")
    }

    private var dotColor: Color {
        switch model.status.tone {
        case .waiting: Color(white: 0.6)
        case .ready: Color(red: 0.30, green: 0.85, blue: 0.45)
        case .busy: Color(red: 0.35, green: 0.65, blue: 1.0)
        case .problem: Color(red: 1.0, green: 0.62, blue: 0.25)
        }
    }
}
