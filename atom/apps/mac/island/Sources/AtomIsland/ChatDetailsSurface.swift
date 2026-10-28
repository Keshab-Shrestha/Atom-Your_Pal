import SwiftUI
import AtomIslandCore

/// The Details surface of the workspace pane (from the HTML preview's Details pane): what the open chat remembers and may
/// use, beside the conversation. It reads the runtime's own inspection of the saved chat and changes nothing, except that
/// "Edit brief" opens the existing brief editor. The chat menu's "What this chat remembers" shows the same facts in a popover.
struct ChatDetailsSurface: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @State private var editing: BriefSheet?

    private struct BriefSheet: Identifiable {
        let id: String
        let brief: ChatBrief
    }

    var body: some View {
        let saved = model.chatControls.snapshot.flatMap { $0.id == model.savedChat?.id ? $0 : nil }
        Scrollable {
            VStack(alignment: .leading, spacing: 18) {
                if let info = saved?.info {
                    let facts = ChatDetailsFacts(info: info)
                    section("Context") {
                        Text(facts.messagesText)
                        contextBar(facts.contextFraction)
                        Text("Replay estimate \(facts.contextText) · \(facts.percentText)").monospacedDigit()
                        if let omitted = facts.omittedText { quiet(omitted) }
                        quiet("ATOM's own estimate of what it sends again to continue this chat. It is not a provider token meter.")
                    }
                } else {
                    Text("Send a message to save this chat, or refresh its details.").foregroundStyle(theme.text3.color)
                }
                if let brief = saved?.brief {
                    section("Brief") {
                        if brief.text.isEmpty { quiet("No brief yet. A brief is background you keep for this chat.") }
                        else { Text(verbatim: brief.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
                        if !snapshot {
                            Button("Edit brief") { editing = BriefSheet(id: model.savedChat?.id ?? "", brief: brief) }
                                .disabled(!model.chatBranchAvailable || model.chats?.currentReadOnlyNotice != nil)
                        }
                    }
                }
                section("Memory used") {
                    if let recall = saved?.recall {
                        Text(recall.summary).fixedSize(horizontal: false, vertical: true)
                        quiet("Prepared " + recall.at)
                        DisclosureGroup("Details") { Text(verbatim: recall.details).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
                    } else {
                        quiet("No memory record for this chat yet. Records start with requests made by the updated runtime.")
                    }
                }
                if let continuity = saved?.continuity {
                    section("Older-message summaries") { Text(continuity.status) }
                }
                if let facts = saved?.info.map(ChatDetailsFacts.init(info:)), !facts.accessRows.isEmpty {
                    section("This chat may use") {
                        ForEach(facts.accessRows, id: \.title) { row in
                            HStack { Text(row.title); Spacer(minLength: 8); Text(row.value).foregroundStyle(theme.text2.color) }
                        }
                        quiet("Memory never grants file or tool access.")
                    }
                }
                if !snapshot { Button("Refresh details", action: model.inspectSavedChat) }
            }
            .appFont(.system(size: 12)).foregroundStyle(theme.text.color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
        }
        .sheet(item: $editing) { sheet in ChatBriefEditor(model: model, chat: sheet.id, initial: sheet.brief) }
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    /// A thin bar for the replay share. Drawn here because snapshots cannot draw AppKit's progress view.
    private func contextBar(_ fraction: Double) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(theme.fill3.color)
                if fraction > 0 { Capsule().fill(theme.accent.color).frame(width: max(3, geometry.size.width * fraction)) }
            }
        }.frame(height: 5).accessibilityHidden(true)
    }

    private func quiet(_ text: String) -> some View {
        Text(text).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
    }
}
