import SwiftUI
import AtomIslandCore

/// B3.5: "Find skills": search the skills hub, read a skill in full, then install it or not. An installed skill is given
/// to no agent until Keshab chooses it on the agent's page.
struct HubSkillsSection: View {
    let model: IslandModel
    let hub: HubState
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let query = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private static let queryLimit = 60

    init(model: IslandModel, hub: HubState) {
        self.model = model
        self.hub = hub
    }

    private var text: Binding<String> {
        Binding(get: { query.wrappedValue }, set: { query.wrappedValue = $0 })
    }
    private var canSearch: Bool { !query.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Find skills").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            HStack(spacing: 8) {
                Group {
                    if snapshot {
                        Text(query.wrappedValue.isEmpty ? "Search community skills" : query.wrappedValue)
                            .foregroundStyle(query.wrappedValue.isEmpty ? theme.text3.color : theme.text.color).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        TextField("Search community skills", text: text).textFieldStyle(.plain).onSubmit(search)
                            .accessibilityLabel("Search community skills").accessibilityHint("Type a word, then choose Search")
                    }
                }
                .font(.system(size: 12))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                    .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
                QuietButton(title: "Search", symbol: "magnifyingglass", action: search)
                    .disabled(!canSearch).opacity(canSearch ? 1 : 0.5)
                    .accessibilityHint("Looks for skills shared by the community")
            }
            if let message = hub.message, !message.isEmpty {
                Text(message).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(hub.pending) { pending in SkillHubCard(model: model, pending: pending) }
            ForEach(hub.results) { result in HubResultRow(model: model, result: result) }
            ForEach(hub.installed) { skill in HubInstalledRow(model: model, skill: skill) }
        }
    }

    private func search() { model.sendHelpers(model.helpers.hubSearch(query.wrappedValue)) }
}

private struct HubResultRow: View {
    let model: IslandModel
    let result: HubSkillResult
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(result.name).font(theme.idFont(.system(size: 12.5, weight: .medium), size: 12)).foregroundStyle(theme.text.color)
                Text("\(result.repo) \(result.shortSha)").font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                QuietButton(title: "Review", symbol: "doc.text") { model.sendHelpers(model.helpers.hubPreview(result)) }
                    .accessibilityLabel("Review \(result.name)")
                    .accessibilityHint("Shows the whole skill so you can read it before you install it")
            }
            if !result.description.isEmpty { Text(result.description).font(.system(size: 11.5)).foregroundStyle(theme.text3.color).lineLimit(2) }
        }
        .padding(.vertical, 4)
    }
}

/// A skill from the hub, shown in full with the scan's flags; Approve installs it, Reject drops it.
private struct SkillHubCard: View {
    let model: IslandModel
    let pending: HubSkillPending
    private let asking = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        SkillCard {
            HStack(spacing: 8) {
                Text(pending.isUpdate ? "Update" : "New skill").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Text(pending.name).font(theme.idFont(.system(size: 13, weight: .semibold), size: 12.5)).foregroundStyle(theme.text.color)
                Spacer(minLength: 8)
                QuietButton(title: "Approve", symbol: "checkmark") { asking.wrappedValue = true }
                    .accessibilityHint("Asks you to confirm the install")
                    .confirmationDialog("Install this skill?", isPresented: asking.projectedValue) {
                        Button("Install") { model.sendHelpers(model.helpers.answerHub(pending.id, approve: true)) }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("It will not be given to any agent until you choose.")
                    }
                QuietButton(title: "Reject", symbol: "xmark") { model.sendHelpers(model.helpers.answerHub(pending.id, approve: false)) }
            }
            Text("from \(pending.repo) at \(pending.shortSha)").font(.system(size: 11)).foregroundStyle(theme.text2.color)
            if pending.isUpdate { Text("Replaces the installed text").font(.system(size: 11)).foregroundStyle(theme.text2.color) }
            if !pending.description.isEmpty { Text(pending.description).font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true) }
            ForEach(Array(pending.sortedFlags.enumerated()), id: \.offset) { _, flag in
                Text("\(flag.kind): \(flag.excerpt)").font(.system(size: 11)).fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(flag.severity == .warn ? theme.problem.color : theme.text3.color)
                    .accessibilityLabel("\(flag.severity == .warn ? "Warning" : "Note"), \(flag.kind): \(flag.excerpt)")
            }
            ScrollView {
                Text(pending.text).font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text2.color)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            .frame(maxHeight: 280)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                .strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: 1))
            .accessibilityLabel("Full text of \(pending.name)")
            Text("Nothing uses it until you approve it, and then only the agents you choose.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }
    }
}

private struct HubInstalledRow: View {
    let model: IslandModel
    let skill: HubSkillInstalled
    private let asking = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Text(skill.name).font(theme.idFont(.system(size: 12.5, weight: .medium), size: 12)).foregroundStyle(theme.text.color)
            Text("Hub").font(.system(size: 10.5)).foregroundStyle(theme.accent.color)
            Text(skill.shortSha).font(theme.idFont(.system(size: 10.5), size: 10)).foregroundStyle(theme.text3.color)
            Spacer(minLength: 8)
            QuietButton(title: "Check for update", symbol: "arrow.triangle.2.circlepath") { model.sendHelpers(model.helpers.hubUpdate(skill.name)) }
                .accessibilityLabel("Check \(skill.name) for an update")
            QuietButton(title: "Uninstall", symbol: "trash") { asking.wrappedValue = true }
                .accessibilityLabel("Uninstall \(skill.name)")
                .confirmationDialog("Uninstall \(skill.name)?", isPresented: asking.projectedValue) {
                    Button("Uninstall", role: .destructive) { model.sendHelpers(model.helpers.hubUninstall(skill.name)) }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("It is removed from ATOM's skills.")
                }
        }
        .padding(.vertical, 4)
    }
}
