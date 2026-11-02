import AppKit
import SwiftUI
import ArkIslandCore

/// The voice pill (2026-11-02, after the "Hold fn to talk" reference Keshab chose): while ARK listens, for Talk or dictation, a pill under the
/// menu bar shows that the microphone is live, a dot-matrix meter that moves with the voice, and the words heard so far. It only reads the
/// status and the meter; it takes no clicks, so it never steals focus from the app being typed into.
struct VoicePill: View {
    let model: IslandModel
    static let size = CGSize(width: 380, height: 66)
    private static let columns = 16, rows = 4
    @Environment(\.theme) private var theme

    var body: some View {
        let status = model.status
        let transcribing = status.kind == .transcribing
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Glyph(systemName: "mic.fill").foregroundStyle(theme.accent.color)
                Text(transcribing ? "Writing it down" : status.title).foregroundStyle(theme.text.color)
                Spacer(minLength: 12)
                if !transcribing { dots }
            }
            .appFont(.system(size: 13, weight: .semibold))
            Text(line(status, transcribing: transcribing))
                .appFont(.system(size: 13))
                .foregroundStyle(status.preview.isEmpty || transcribing ? theme.text3.color : theme.text2.color)
                .lineLimit(1).truncationMode(.head) // the newest words stay in view
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(width: Self.size.width, height: Self.size.height, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Self.size.height / 2.6, style: .continuous).fill(theme.surfaceSolid.color))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(transcribing ? "ARK is writing down what you said" : "ARK is listening")
    }

    private func line(_ status: IslandStatus, transcribing: Bool) -> String {
        if transcribing { return status.preview.isEmpty ? "One moment" : status.preview }
        return status.preview.isEmpty ? "Speak now" : status.preview
    }

    /// The meter's recent levels as columns of dots, newest on the right.
    private var dots: some View {
        let levels = Array(model.meter.history.suffix(Self.columns))
        return HStack(spacing: 2.5) {
            ForEach(levels.indices, id: \.self) { column in
                let lit = LevelMeter.litDots(levels[column], rows: Self.rows)
                VStack(spacing: 2.5) {
                    ForEach(0..<Self.rows, id: \.self) { row in
                        Circle().fill(Self.rows - row <= lit ? theme.accent.color : theme.text3.color.opacity(0.25)).frame(width: 3, height: 3)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Reads the theme and text size on every render, so a change in Settings reaches the open pill.
private struct VoicePillRoot: View {
    let model: IslandModel
    var body: some View { VoicePill(model: model).themed(model.settings.theme.palette).appTypography(model.settings) }
}

/// The pill's window: centred under the menu bar of the screen with the menu bar, above other windows, never key, never clicked.
@MainActor
final class VoicePillController {
    private let panel: NSPanel
    private var visible = false

    init(model: IslandModel) {
        panel = NSPanel(contentRect: NSRect(origin: .zero, size: VoicePill.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true // it floats over any wallpaper: the system's soft shadow keeps it apart
        panel.isFloatingPanel = true // before `level`: setting it resets the level
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let hosting = NSHostingView(rootView: VoicePillRoot(model: model))
        hosting.sizingOptions = []
        panel.contentView = hosting
    }

    /// Shows the pill while ARK listens or writes down what it heard; hides it otherwise.
    func update(listening: Bool) {
        guard listening != visible else { return }
        visible = listening
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if listening {
            guard let screen = NSScreen.screens.first ?? NSScreen.main else { return }
            let area = screen.visibleFrame
            panel.setFrame(NSRect(x: area.midX - VoicePill.size.width / 2, y: area.maxY - VoicePill.size.height - 10,
                                  width: VoicePill.size.width, height: VoicePill.size.height), display: false)
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { $0.duration = reduceMotion ? 0 : 0.18; panel.animator().alphaValue = 1 }
        } else {
            NSAnimationContext.runAnimationGroup({ $0.duration = reduceMotion ? 0 : 0.18; panel.animator().alphaValue = 0 }) { [weak panel] in
                Task { @MainActor in panel?.orderOut(nil) }
            }
        }
    }
}
