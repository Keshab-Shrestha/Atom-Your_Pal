import SwiftUI
import ZenoIslandCore

// MARK: - Right: a soul (Task 3.3)

/// The chosen worker's soul as a form: name, personality, how it works, rules, lessons. Save makes a new version; the
/// Versions menu makes an older one current again (itself a new version, so it can be undone).
struct SoulPane: View {
    let model: IslandModel
    let helper: Helper
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let draft: State<HelperSoul>
    @Environment(\.theme) private var theme

    init(model: IslandModel, helper: Helper, soul: HelperSoul) {
        self.model = model
        self.helper = helper
        draft = State(initialValue: soul)
    }

    var body: some View {
        let changed = draft.wrappedValue.trimmed != helper.soul
        Scrollable {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    QuietButton(title: helper.available ? "Jobs" : helper.name, symbol: "chevron.left") { model.helpers.closeSoul() }
                    Spacer(minLength: 8)
                    VersionsMenu(model: model, helper: helper)
                    SaveButton(enabled: changed) { model.sendHelpers(model.helpers.saveSoul(draft.wrappedValue)) }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(helper.name)'s soul").font(theme.isFlat ? .system(size: 24, weight: .regular, design: .serif) : .system(size: 20, weight: .semibold, design: .rounded))
                        .foregroundStyle(theme.isFlat ? Color.white : theme.text.color)
                    Text("Given to \(helper.name) as instructions for every job. Its tools and limits are set by its role\(helper.roleTitle.isEmpty ? "" : " (\(helper.roleTitle))"), not here.")
                        .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                SoulField(label: "Name", text: binding(\.name), limit: HelperSoul.limits.name, lines: 1)
                SoulField(label: "Personality", text: binding(\.personality), limit: HelperSoul.limits.personality, lines: 2)
                SoulField(label: "How it works", text: binding(\.howItWorks), limit: HelperSoul.limits.howItWorks, lines: 3)
                SoulField(label: "Rules", text: binding(\.rules), limit: HelperSoul.limits.rules, lines: 3)
                SoulField(label: "Lessons learned", text: binding(\.lessons), limit: HelperSoul.limits.lessons, lines: 3)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.panel + 4)
            .padding(.top, 30)
            .padding(.bottom, Spacing.panel)
        }
    }

    private func binding(_ key: WritableKeyPath<HelperSoul, String>) -> Binding<String> {
        Binding(get: { draft.wrappedValue[keyPath: key] }, set: { draft.wrappedValue[keyPath: key] = $0 })
    }
}

/// One soul field: a quiet label with a character count, and the text in a well.
private struct SoulField: View {
    let label: String
    let text: Binding<String>
    let limit: Int
    let lines: Int
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let count = text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).count
        let shape = RoundedRectangle(cornerRadius: lines == 1 ? theme.radiusControl + 2 : theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
                Spacer()
                Text("\(count) / \(limit)").font(theme.idFont(.system(size: 10.5), size: 10))
                    .foregroundStyle(count > limit ? theme.problem.color : theme.text3.color)
            }
            Group {
                if snapshot { // ImageRenderer cannot draw text fields
                    Text(text.wrappedValue.isEmpty ? " " : text.wrappedValue).frame(maxWidth: .infinity, alignment: .topLeading)
                } else if lines == 1 {
                    TextField(label, text: text).textFieldStyle(.plain)
                } else {
                    TextEditor(text: text).scrollContentBackground(.hidden).frame(minHeight: CGFloat(lines) * 18)
                }
            }
            .font(.system(size: 12.5))
            .foregroundStyle(theme.text.color)
            .padding(.horizontal, lines == 1 ? 12 : 8)
            .padding(.vertical, lines == 1 ? 8 : 7)
            .background(shape.fill(theme.isFlat ? Color.clear : theme.fill1.color))
            .overlay(shape.strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
            .accessibilityLabel(label)
        }
    }
}

/// "Versions": the listed versions, newest first, each with when it was saved; picking an older one restores it.
private struct VersionsMenu: View {
    let model: IslandModel
    let helper: Helper

    var body: some View {
        Menu {
            ForEach(helper.soulVersions) { version in
                Button { model.sendHelpers(model.helpers.restoreSoul(version.version)) } label: {
                    let title = Self.title(version)
                    if version.version == helper.soulVersion { Label(title, systemImage: "checkmark") } else { Text("Restore \(title)") }
                }
                .disabled(version.version == helper.soulVersion)
            }
        } label: {
            PillMenuLabel(label: "Version", value: "\(helper.soulVersion)")
        }
        .menuStyle(.button).buttonStyle(.plain).fixedSize()
        .disabled(helper.soulVersions.count < 2)
        .help("Restore an earlier version of \(helper.name)'s soul")
        .accessibilityLabel("\(helper.name)'s soul versions")
    }

    static func title(_ version: SoulVersion) -> String {
        guard let date = version.createdAt else { return "version \(version.version)" }
        return "version \(version.version), \(date.formatted(date: .abbreviated, time: .shortened))"
    }
}

/// Save: lit when there is a change to save.
private struct SaveButton: View {
    let enabled: Bool
    let action: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            Text("Save")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(enabled ? (theme.isGhost ? theme.text.color : theme.onAccent.color) : theme.text3.color)
                .padding(.horizontal, 14)
                .frame(height: 26)
                .background(ControlFill(RoundedRectangle(cornerRadius: theme.isGhost ? theme.radiusControl : 13, style: .continuous),
                                        fill: enabled ? AnyShapeStyle(theme.accentFill) : AnyShapeStyle(theme.fill2.color), hovering: enabled))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .keyboardShortcut("s", modifiers: .command)
        .accessibilityLabel("Save soul")
    }
}

