import SwiftUI
import ZenoIslandCore

struct ShortcutSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        Card(footer: footer) {
            ForEach(Array(ShortcutAction.allCases.enumerated()), id: \.element) { index, action in
                if index > 0 { RowDivider() }
                VStack(alignment: .leading, spacing: 4) {
                    Row(title: action.title, detail: action.detail) {
                        HStack(spacing: 4) {
                            RecorderButton(model: model, action: action)
                            if model.settings.shortcut(for: action) != action.defaultCombo, !model.recorder.isRecording {
                                IconButton(symbol: "arrow.uturn.backward", label: "Reset to \(action.defaultCombo.display)") {
                                    model.settings.resetShortcut(for: action)
                                }
                            }
                        }
                    }
                    if let problem = model.recorder.problem, problem.action == action {
                        Label(problem.message, systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 10.5))
                            .foregroundStyle(theme.problem.color)
                            .padding(.horizontal, 11)
                            .padding(.bottom, 6)
                    }
                }
            }
            if let engine = model.shortcuts, !engine.canTrackKeys {
                RowDivider()
                VStack(alignment: .leading, spacing: 7) {
                    Label("Hold shortcuts need Input Monitoring", systemImage: "keyboard.badge.ellipsis")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(theme.attention.color)
                    Text("macOS asks before an app can see which keys are held. ZENO only watches for its own shortcuts, never what you type.")
                        .font(.system(size: 10.5))
                        .foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                    PillButton(title: "Allow in System Settings…", prominent: true) { engine.requestKeyAccess() }
                }
                .padding(11)
            }
        }
        ResetPageCard(footer: "Every shortcut goes back to its default, including any you turned off.") {
            model.recorder.stop()
            model.settings.resetAllShortcuts()
        }
    }

    private var footer: String {
        if model.recorder.isRecording {
            return "Press the new keys. For a hold shortcut, hold the modifiers (e.g. ⌃⌥ or Right ⌘⌥) and let go. Esc cancels, Delete turns it off."
        }
        return "Click a shortcut to change it. Shortcuts work in every app; Cancel only while ZENO listens, speaks or dictates."
    }
}

struct RecorderButton: View {
    let model: IslandModel
    let action: ShortcutAction
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    private var recording: Bool { model.recorder.action == action }

    var body: some View {
        Button {
            model.recorder.toggle(action)
        } label: {
            Text(label)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(recording ? theme.accent.color : (model.settings.shortcut(for: action) == nil ? theme.text2.color : theme.text.color))
                .frame(minWidth: 64)
                .padding(.horizontal, 8)
                .frame(height: 24)
                .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .fill(recording ? theme.accent.color.opacity(0.14) : (hovering.wrappedValue ? theme.fill3.color : theme.fill2.color)))
                .overlay(
                    RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                        .strokeBorder(recording ? theme.accent.color : .clear, lineWidth: 1.2))
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .accessibilityLabel("\(action.title) shortcut: \(model.settings.shortcut(for: action)?.spokenDescription ?? "off")")
        .accessibilityHint("Click, then press the new keys")
    }

    private var label: String {
        if recording {
            let held = model.recorder.held
            return held.isEmpty ? "Press keys…" : KeyCombo(modifiers: held).display
        }
        return model.settings.shortcut(for: action)?.display ?? "Off"
    }
}
