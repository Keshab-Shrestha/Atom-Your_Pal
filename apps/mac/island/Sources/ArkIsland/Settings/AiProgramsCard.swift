import SwiftUI
import ArkIslandCore

/// ADR-269: the AI programs found on this Mac, kept current by the runtime (at start, every 10 minutes, on Rescan).
/// A ready program has a "may use" switch; one switched off leaves the model picker. No Menu: snapshot-safe.
struct AiProgramsCard: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let state = model.aiPrograms
        let found = state?.programs.filter(\.found) ?? []
        let missing = (state?.programs.count ?? 0) - found.count
        Card("Found on this Mac", footer: footer(missing: missing)) {
            if state == nil {
                Row(title: "Looking for AI programs…") { ProgressView().controlSize(.small) }
            } else if found.isEmpty {
                Row(title: "No AI programs found", detail: "Install one, then press Rescan.") { EmptyView() }
            }
            ForEach(Array(found.enumerated()), id: \.element.id) { index, program in
                if index > 0 { RowDivider() }
                AiProgramRow(program: program) { model.send(.aiProgramsAllow(id: program.id, allowed: $0)) }
            }
            RowDivider()
            Row(title: "Look again", detail: state?.scannedAt.map { "Last scan " + $0.formatted(.relative(presentation: .named)) }) {
                HStack(spacing: 8) {
                    if model.scanningPrograms { ProgressView().controlSize(.mini) }
                    PillButton(title: "Rescan") {
                        model.scanningPrograms = true
                        model.send(.aiProgramsScan)
                    }
                    .disabled(model.scanningPrograms)
                }
            }
        }
    }

    private func footer(missing: Int) -> String {
        let looked = missing > 0 ? " ARK also looked for \(missing) other programs that are not installed." : ""
        return "ARK chats only with Ready programs you allow. Claude and Codex can use ARK's tools and file agents. Codex workers use checked file tools; shell, web, browser and external MCP tools are not available to them yet. Gemini CLI is text-only. Chats keep their conversation when the model changes. Local model programs are listed, but ARK does not use local models. Local text backup is configured separately and never replaces these providers automatically.\(looked)"
    }
}

/// One program: icon, name, version and place, a status chip, and the may-use switch for a ready one.
struct AiProgramRow: View {
    let program: AiProgram
    let allow: (Bool) -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            icon.frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(program.name).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
                Text(detail).appFont(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            chip
            if program.status == "ready" {
                ThemedSwitch(isOn: program.allowed, set: allow, label: "Let ARK use \(program.name)")
            }
        }
        .padding(.horizontal, Spacing.well)
        .padding(.vertical, 9)
        .frame(minHeight: 40)
    }

    @ViewBuilder private var icon: some View {
        // A program with no provider of its own still shows its maker's mark when ARK has one (ADR-269 program ids).
        let logo = program.provider ?? program.id
        if ProviderLogo.mark(logo) != nil {
            ProviderIcon(provider: logo, size: 16)
        } else {
            Glyph(systemName: program.status == "local-model" ? "cpu" : "terminal").appFont(.system(size: 13)).foregroundStyle(theme.text2.color)
        }
    }

    private var detail: String {
        let signed = program.signedIn == true ? "signed in" : nil
        return [program.version.map { "v\($0)" }, program.path, signed, program.note].compactMap { $0 }.joined(separator: " · ")
    }

    private var chip: some View {
        let (text, color): (String, RGBA) = switch program.status {
        case "ready": ("Ready", theme.success)
        case "local-model": ("Local model, not used", theme.text3)
        default: ("Found, not connected yet", theme.attention)
        }
        return Text(text)
            .appFont(.system(size: 10, weight: .medium))
            .foregroundStyle(color.color)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(color.color.opacity(0.12)))
            .fixedSize()
    }
}
