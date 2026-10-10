import SwiftUI
import ZenoIslandCore

/// What ZENO keeps about the user (ADR-058): every fact, when it was kept, and a way to forget it.
struct MemorySection: View {
    let model: IslandModel
    private let confirming = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            if let memory = model.memory {
                if !memory.enabled {
                    Card(footer: "Memory is turned off for this runtime (ZENO_MEMORY=0 in .env).") {
                        Row(title: "Memory is off", detail: "ZENO forgets everything when it quits") { EmptyView() }
                    }
                } else if memory.memories.isEmpty {
                    EmptyMemoryCard()
                    EpisodesCard(model: model, episodes: memory.episodes)
                } else {
                    Card(memory.count == 1 ? "1 fact" : "\(memory.count) facts", footer: hint) {
                        ForEach(Array(memory.memories.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { RowDivider() }
                            MemoryRow(item: item) { model.forgetMemory(item.id) }
                        }
                    }
                    EpisodesCard(model: model, episodes: memory.episodes)
                    Card(footer: "Deletes every fact for good. ZENO cannot get them back.") {
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

private struct EmptyMemoryCard: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Card(footer: "Kept on this Mac only, and shared with the AI model when it helps answer.") {
            VStack(spacing: 6) {
                Image(systemName: "brain.head.profile").font(.system(size: 20, weight: .regular)).foregroundStyle(theme.text2.color)
                Text("Nothing kept yet").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                Text("Say “Remember that…” and ZENO keeps it, even after a restart.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text2.color).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .padding(.horizontal, 12)
        }
    }
}

/// ZENO's notes from recent conversations (ADR-059): what each was about, so a new one can pick up from it.
private struct EpisodesCard: View {
    let model: IslandModel
    let episodes: [EpisodeItem]
    @Environment(\.theme) private var theme

    var body: some View {
        if !episodes.isEmpty {
            Card("Recent conversations", footer: "ZENO's own short notes, so it can pick up where you left off. The newest 50 are kept.") {
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
                    .background(Circle().fill(theme.fill2.color))
            }
            .buttonStyle(.plain)
            .opacity(hovering.wrappedValue ? 1 : 0.6)
            .accessibilityLabel("Remove")
            .help("Remove")
        }
        .padding(.horizontal, 11)
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
                    .background(Circle().fill(theme.fill2.color))
            }
            .buttonStyle(.plain)
            .opacity(hovering.wrappedValue ? 1 : 0.6) // always findable, clear on hover
            .accessibilityLabel("Forget this")
            .help("Forget this")
        }
        .padding(.horizontal, 11)
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
