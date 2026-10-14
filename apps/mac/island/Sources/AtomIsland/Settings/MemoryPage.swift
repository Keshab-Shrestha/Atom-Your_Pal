import SwiftUI
import AtomIslandCore

/// What ATOM keeps about the user (ADR-058): every fact, when it was kept, and a way to forget it.
struct MemorySection: View {
    let model: IslandModel
    private let confirming = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            if let memory = model.memory {
                if !memory.enabled {
                    Card(footer: "Memory is turned off for this runtime (ATOM_MEMORY=0 in .env).") {
                        Row(title: "Memory is off", detail: "ATOM forgets everything when it quits") { EmptyView() }
                    }
                } else if memory.memories.isEmpty {
                    BrainLinkCard(model: model)
                    EmptyMemoryCard()
                    KeptChatsCard(model: model, chats: memory.chats)
                    EpisodesCard(model: model, episodes: memory.episodes)
                } else {
                    BrainLinkCard(model: model)
                    Card(memory.count == 1 ? "1 fact" : "\(memory.count) facts", footer: hint) {
                        ForEach(Array(memory.memories.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { RowDivider() }
                            MemoryRow(item: item) { model.forgetMemory(item.id) }
                        }
                    }
                    KeptChatsCard(model: model, chats: memory.chats)
                    EpisodesCard(model: model, episodes: memory.episodes)
                    Card(footer: "Deletes every fact for good. ATOM cannot get them back.") {
                        Row(title: "Forget all facts") {
                            if confirming.wrappedValue {
                                HStack(spacing: 6) {
                                    PillButton(title: "Cancel") { confirming.wrappedValue = false }
                                    PillButton(title: "Forget all", prominent: true) {
                                        confirming.wrappedValue = false
                                        model.forgetAllMemory()
                                    }
                                }
                            } else {
                                PillButton(title: "Forget…") { confirming.wrappedValue = true }
                            }
                        }
                    }
                }
            } else {
                Card { Row(title: "Loading…") { ProgressView().controlSize(.small) } }
            }
        }
        .onAppear { model.loadMemory() }
    }

    private var hint: String {
        "Kept on this Mac only and shared with the AI model when it helps answer. Say “Forget that…” or remove a fact here."
    }
}

/// The way from Memory to the second brain: the same facts and notes, as a graph of linked notes.
private struct BrainLinkCard: View {
    let model: IslandModel

    var body: some View {
        Card(footer: "Facts and conversation notes appear in the graph too, linked by the names they share. Write your own notes there.") {
            Row(title: "Second brain", detail: "Your notes as a graph") {
                PillButton(title: "Open graph", symbol: "brain.head.profile") { model.navigate { model.windowPage = .brain } }
            }
        }
    }
}

private struct EmptyMemoryCard: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Card(footer: "Kept on this Mac only, and shared with the AI model when it helps answer.") {
            VStack(spacing: 6) {
                Image(systemName: "brain.head.profile").font(.system(size: 20, weight: .regular)).foregroundStyle(theme.text2.color)
                Text("Nothing kept yet").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                Text("Say “Remember that…” and ATOM keeps it, even after a restart.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text2.color).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .padding(.horizontal, 12)
        }
    }
}

/// ADR-097: recent chats with a box to keep each one in memory, and Save. A kept chat shows as kept with Remove.
/// ATOM keeps a kept chat as a summary, topic sections and exact lines, and searches them for every request.
private struct KeptChatsCard: View {
    let model: IslandModel
    let chats: [MemoryChatItem]
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let chosen = State(initialValue: Set<String>())
    @Environment(\.theme) private var theme

    init(model: IslandModel, chats: [MemoryChatItem]) {
        self.model = model
        self.chats = chats
    }

    var body: some View {
        let picked = chosen.wrappedValue.filter { id in chats.contains { $0.id == id && !$0.kept && !$0.indexing } }
        if !chats.isEmpty {
            Card("Recent chats", footer: "Kept chats stay on this Mac. ATOM searches them by words and by meaning, and uses the best lines when they help.") {
                ForEach(Array(chats.enumerated()), id: \.element.id) { index, chat in
                    if index > 0 { RowDivider() }
                    Row(title: chat.title, detail: caption(chat)) { trailing(chat) }
                }
                RowDivider()
                HStack {
                    Text(picked.isEmpty ? "Choose chats to keep" : picked.count == 1 ? "1 chat chosen" : "\(picked.count) chats chosen")
                        .font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                    Spacer()
                    SaveButton(enabled: !picked.isEmpty, label: "Keep chosen chats in memory") {
                        model.keepChats(picked)
                        chosen.wrappedValue = []
                    }
                }
                .padding(.horizontal, Spacing.well)
                .padding(.vertical, 8)
            }
            .tracksEdits(model, "memory.keptChats", !picked.isEmpty)
        }
    }

    @ViewBuilder private func trailing(_ chat: MemoryChatItem) -> some View {
        if chat.indexing {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Keeping…").font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
            }
        } else if chat.kept {
            HStack(spacing: 6) {
                Label("Kept", systemImage: "checkmark.circle.fill").labelStyle(.titleAndIcon)
                    .font(.system(size: 10.5, weight: .medium)).foregroundStyle(theme.text2.color)
                PillButton(title: "Remove") { model.dropKeptChat(chat.id) }
            }
        } else {
            Toggle("Keep in memory", isOn: Binding(
                get: { chosen.wrappedValue.contains(chat.id) },
                set: { on in
                    if on { chosen.wrappedValue.insert(chat.id) } else { chosen.wrappedValue.remove(chat.id) }
                }
            ))
            .toggleStyle(.checkbox)
            .font(.system(size: 10.5))
        }
    }

    private func caption(_ chat: MemoryChatItem) -> String {
        let n = chat.messages == 1 ? "1 message" : "\(chat.messages) messages"
        guard let date = chat.updatedAt ?? chat.keptAt else { return n }
        return "\(date.formatted(date: .abbreviated, time: .shortened)) · \(n)"
    }
}

/// ATOM's notes from recent conversations (ADR-059): what each was about, so a new one can pick up from it.
private struct EpisodesCard: View {
    let model: IslandModel
    let episodes: [EpisodeItem]
    @Environment(\.theme) private var theme

    var body: some View {
        if !episodes.isEmpty {
            Card("Recent conversations", footer: "ATOM's own short notes, so it can pick up where you left off. The newest 50 are kept.") {
                ForEach(Array(episodes.prefix(8).enumerated()), id: \.element.id) { index, episode in
                    if index > 0 { RowDivider() }
                    NoteRow(text: episode.summary, caption: caption(episode)) { model.forgetEpisode(episode.id) }
                }
                RowDivider()
                Row(title: episodes.count > 8 ? "\(episodes.count) notes in all" : "Clear these notes") {
                    PillButton(title: "Clear") { model.forgetAllEpisodes() }
                }
            }
        }
    }

    private func caption(_ e: EpisodeItem) -> String {
        let n = e.exchanges == 1 ? "1 exchange" : "\(e.exchanges) exchanges"
        guard let date = e.endedAt else { return n }
        return "\(date.formatted(.relative(presentation: .named))) · \(n)"
    }
}

/// A line of text with a caption and a remove button (faint until hovered).
private struct NoteRow: View {
    let text: String
    let caption: String
    let remove: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(text).font(.system(size: 12)).foregroundStyle(theme.text.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(caption).font(.system(size: 10)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 4)
            Button(action: remove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(theme.text2.color)
                    .frame(width: 20, height: 20)
                    .background(ControlFill(Circle(), fill: theme.fill2.color, hovering: hovering.wrappedValue))
            }
            .buttonStyle(.plain)
            .opacity(hovering.wrappedValue ? 1 : 0.6)
            .accessibilityLabel("Remove")
            .help("Remove")
        }
        .padding(.horizontal, Spacing.well)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
    }
}

/// One kept fact: its text, when and how it was kept, and a remove button that shows on hover.
private struct MemoryRow: View {
    let item: MemoryItem
    let forget: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text).font(.system(size: 12)).foregroundStyle(theme.text.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(caption).font(.system(size: 10)).foregroundStyle(theme.text3.color)
            }
            Spacer(minLength: 4)
            Button(action: forget) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(theme.text2.color)
                    .frame(width: 20, height: 20)
                    .background(ControlFill(Circle(), fill: theme.fill2.color, hovering: hovering.wrappedValue))
            }
            .buttonStyle(.plain)
            .opacity(hovering.wrappedValue ? 1 : 0.6) // always findable, clear on hover
            .accessibilityLabel("Forget this")
            .help("Forget this")
        }
        .padding(.horizontal, Spacing.well)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
    }

    private var caption: String {
        let how = item.source == "text" ? "Typed" : "Said"
        guard let date = item.createdAt else { return how }
        return "\(how) · \(date.formatted(.relative(presentation: .named)))"
    }
}
