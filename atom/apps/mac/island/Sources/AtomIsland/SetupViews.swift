import SwiftUI
import AtomIslandCore

// ADR-075: the permissions checklist, the first-launch card and the plain error cards.

/// Cards above the conversation: the first-launch card until Microphone and Input Monitoring are granted, and the
/// last known setup failure in plain words.
struct SetupCards: View {
    let model: IslandModel

    static func isShown(_ model: IslandModel) -> Bool {
        model.status.failure != nil || !model.permissions.essentialGranted
    }

    var body: some View {
        let failure = model.status.failure
        let firstLaunch = !model.permissions.essentialGranted
        if failure != nil || firstLaunch {
            VStack(spacing: 10) {
                if let failure { FailureCard(model: model, failure: failure) }
                if firstLaunch {
                    Card("Set up ATOM", footer: "ATOM needs these two to hear you. Everything else is asked the first time you use it.") {
                        ForEach(Array(PermissionRow.essential.enumerated()), id: \.element) { index, row in
                            if index > 0 { RowDivider() }
                            PermissionRowView(model: model, row: row)
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 14)
        }
    }
}

/// One known failure: the sentence and one button. When the runtime has stopped, "Restart ATOM" and "Open log".
struct FailureCard: View {
    let model: IslandModel
    let failure: PlainFailure
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let showing = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: failure.offersLog ? "stop.circle.fill" : "exclamationmark.triangle.fill")
                        .appFont(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.problem.color)
                    Text(failure.sentence)
                        .appFont(.system(size: 12, weight: .medium))
                        .foregroundStyle(theme.text.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !failure.offersLog {
                        IconButton(symbol: "xmark", label: "Dismiss") { model.status.dismissFailure() }
                    }
                }
                if case .showCommand(let text) = failure.action, showing.wrappedValue {
                    Text(text)
                        .appFont(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(theme.text.color)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(ControlFill(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous), fill: theme.fill2.color))
                }
                HStack(spacing: 6) {
                    PillButton(title: failure.button, prominent: true) {
                        if case .showCommand = failure.action { showing.wrappedValue.toggle() } else { model.perform(failure.action) }
                    }
                    if failure.offersLog {
                        PillButton(title: "Open log") { model.perform(.openLog) }
                    }
                    Spacer(minLength: 0)
                    // The full message is in Settings' now card, under the last turn (ADR-084).
                    Button {
                        model.openSettings(nil)
                    } label: {
                        Text("Details in Settings")
                            .appFont(.system(size: 10))
                            .foregroundStyle(theme.text3.color)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(Spacing.well)
        }
    }
}

/// Settings → Privacy → Permissions: every row, its state, when ATOM uses it, and one button.
struct PermissionsCard: View {
    let model: IslandModel

    var body: some View {
        Card("Permissions", footer: "Checking never asks macOS for anything. Apps that aren't installed are not listed.") {
            let rows = model.permissions.visibleRows
            ForEach(Array(rows.enumerated()), id: \.element) { index, row in
                if index > 0 { RowDivider() }
                PermissionRowView(model: model, row: row)
            }
        }
    }
}

struct PermissionRowView: View {
    let model: IslandModel
    let row: PermissionRow
    @Environment(\.theme) private var theme

    var body: some View {
        let state = model.permissions.states[row]
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text(row.usage).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true)
                if let state {
                    Label(row.stateLine(state), systemImage: Self.symbol(state))
                        .appFont(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(color(state))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 6)
            PillButton(title: Self.asksOnClick(row, state) ? "Allow…" : "Settings") { model.permissionButton(row) }
                .accessibilityLabel("\(row.title): \(Self.asksOnClick(row, state) ? "allow" : "open System Settings")")
        }
        .padding(.horizontal, Spacing.well)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    /// Microphone and Input Monitoring never asked: the click asks macOS, which then lists ATOM in the pane.
    static func asksOnClick(_ row: PermissionRow, _ state: PermissionState?) -> Bool {
        state == .notAsked && PermissionRow.essential.contains(row)
    }

    private static func symbol(_ state: PermissionState) -> String {
        switch state {
        case .granted: "checkmark.circle.fill"
        case .denied: "xmark.circle.fill"
        default: "circle.dashed"
        }
    }

    private func color(_ state: PermissionState) -> Color {
        switch state {
        case .granted: theme.success.color
        case .denied: theme.problem.color
        default: theme.text3.color
        }
    }
}
