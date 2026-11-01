import SwiftUI
import ArkIslandCore

/// The picker changes only this chat, through the existing runtime-validated chat.model command.
struct ChatModelMenu: View {
    let model: IslandModel
    private struct Presentation: Identifiable { let id: String }
    @State private var presentation: Presentation?
    @Environment(\.theme) private var theme

    var body: some View {
        if let info = model.modelInfo {
            let provider = model.chats?.currentProvider ?? info.provider
            let value = model.chats?.currentModel.map { info.modelName(provider: provider, model: $0) } ?? info.currentModelName
            Button { presentation = Presentation(id: model.chats?.current ?? "") } label: {
                HStack(spacing: 4) {
                    ProviderIcon(provider: provider, size: 12)
                    Text(value + "  ⌄").appFont(.system(size: 12)).lineLimit(1)
                }.foregroundStyle(theme.text2.color)
            }
            .buttonStyle(.plain).fixedSize()
            .help("Choose the provider and model for this chat")
            .accessibilityLabel("Model for this chat: " + value)
            .accessibilityIdentifier("chat.model")
            .disabled(model.chats?.currentReadOnlyNotice != nil)
            .popover(item: $presentation, arrowEdge: .top) { context in
                ChatModelPicker(model: model, info: info, chat: context.id, close: { presentation = nil }).themed(theme)
            }
            .onChange(of: model.chats?.current) { presentation = nil }
        }
    }
}

enum ModelProviderSymbol {
    static func name(_ provider: String) -> String {
        switch provider {
        case "claude-plan": "sparkle"
        case "codex": "hexagon"
        case "gemini-cli": "diamond"
        default: "circle"
        }
    }
}

struct ChatModelPicker: View {
    let model: IslandModel
    let info: ModelInfo
    var chat: String? = nil
    /// Settings → Defaults: choosing sets the app default model (what new chats use) instead of this chat's.
    var setsDefault = false
    var close: () -> Void
    @State private var query = ""
    @State private var filter = "all"
    @State private var cursor = 0
    /// Set only by the arrow keys: a hover moves the highlight but never scrolls (Keshab, 2026-11-02: the list jumped while scrolling).
    @State private var scrollTarget: String?
    @State private var custom = false
    @State private var customId = ""
    @FocusState private var focused: Field?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private enum Field: Hashable { case search, custom }

    private var currentProvider: String { setsDefault ? info.provider : model.chats?.currentProvider ?? info.provider }
    private var currentModel: String { setsDefault ? info.model : model.chats?.currentModel ?? info.model }
    private var entries: [ModelPickerEntry] {
        ModelPickerCatalog.filtered(ModelPickerCatalog.entries(info: info, currentProvider: currentProvider, currentModel: currentModel),
                                    query: query, provider: ["all", "favorites"].contains(filter) ? nil : filter,
                                    favoritesOnly: filter == "favorites", favorites: model.settings.favoriteModels)
    }
    private var customProvider: ProviderOption? {
        info.providers.first { $0.id == filter } ?? info.providers.first { $0.id == currentProvider }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 8) {
                providerButton("all", name: "All models") { Glyph(systemName: "square.grid.2x2") }
                providerButton("favorites", name: "Favorites") { Glyph(systemName: "star.fill") }
                Rectangle().fill(theme.border.color).frame(height: 1).padding(.vertical, 2)
                ForEach(info.providers) { provider in
                    providerButton(provider.id, name: provider.name) { ProviderIcon(provider: provider.id, size: 16) }
                }
                Spacer(minLength: 0)
            }.padding(8).frame(width: 44).background(theme.fill1.color)
            VStack(alignment: .leading, spacing: 0) {
                if custom { customForm }
                else {
                    searchField
                    Rectangle().fill(theme.border.color).frame(height: 1)
                    modelList
                }
                Rectangle().fill(theme.border.color).frame(height: 1)
                footer
            }
        }
        .frame(width: 400, height: 410)
        .background(theme.surfaceSolid.color)
        .onAppear { if !snapshot { focused = .search } }
        .onExitCommand(perform: close)
        .onChange(of: query) { cursor = 0 }
        .onChange(of: filter) { cursor = 0 }
        .onChange(of: entries.map(\.id)) { cursor = min(cursor, max(0, entries.count - 1)) }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Glyph(systemName: "magnifyingglass").foregroundStyle(theme.text3.color)
            if snapshot { Text("Search models…").foregroundStyle(theme.text3.color); Spacer() }
            else {
                TextField("Search models…", text: $query).textFieldStyle(.plain).focused($focused, equals: .search)
                    .onSubmit { if !entries.isEmpty { choose(entries[min(cursor, entries.count - 1)]) } }
                    .onKeyPress(.downArrow) { moveCursor(to: cursor + 1); return .handled }
                    .onKeyPress(.upArrow) { moveCursor(to: cursor - 1); return .handled }
                    .accessibilityLabel("Search models")
            }
            if !query.isEmpty {
                Button { query = "" } label: { Glyph(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain).accessibilityLabel("Clear model search")
            }
        }.appFont(.system(size: 13)).padding(12)
    }

    @ViewBuilder private var modelList: some View {
        if snapshot {
            Scrollable { VStack(alignment: .leading, spacing: 2) { modelRows }.padding(8) }
        } else {
            ScrollViewReader { proxy in
                ArkScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) { modelRows }.padding(8)
                }
                .onChange(of: scrollTarget) {
                    // No anchor: scroll only as far as needed to show the row.
                    if let scrollTarget { proxy.scrollTo(scrollTarget) }
                }
            }
        }
    }

    @ViewBuilder private var modelRows: some View {
        if entries.isEmpty {
            Text(filter == "favorites" && query.isEmpty ? "Star a model to keep it here." : "No matching models.")
                .appFont(.system(size: 12)).foregroundStyle(theme.text3.color).padding(16)
        }
        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
            modelRow(entry, highlighted: cursor == index).id(entry.id)
                .onHover { if $0 { cursor = index } }
        }
    }

    private func modelRow(_ entry: ModelPickerEntry, highlighted: Bool) -> some View {
        let selected = currentProvider == entry.provider && currentModel == entry.model
        let favorite = model.settings.favoriteModels.contains(entry.id)
        return HStack(spacing: 4) {
            Button { choose(entry) } label: {
                HStack(spacing: 8) {
                    ProviderIcon(provider: entry.provider, size: 16).frame(width: 20)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.name).appFont(.system(size: 12.5, weight: selected ? .medium : .regular)).foregroundStyle(theme.text.color).lineLimit(2)
                        Text(entry.providerName + (entry.available ? "" : " · Unavailable on this Mac"))
                            .appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if selected { Glyph(systemName: "checkmark").appFont(.system(size: 10)).foregroundStyle(theme.accent.color) }
                }.padding(.leading, 8).padding(.vertical, 8).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(!entry.available)
                .accessibilityLabel(entry.name + ", " + entry.providerName + (entry.available ? "" : ", unavailable"))
                .accessibilityAddTraits(selected ? .isSelected : [])
            Button { model.settings.toggleFavoriteModel(provider: entry.provider, model: entry.model) } label: {
                Glyph(systemName: favorite ? "star.fill" : "star").appFont(.system(size: 11))
                    .foregroundStyle(favorite ? theme.accent.color : theme.text3.color).frame(width: 26, height: 28)
            }.buttonStyle(.plain).padding(.trailing, 4)
                .disabled(!favorite && model.settings.favoriteModels.count >= 128)
                .accessibilityLabel((favorite ? "Unstar " : "Star ") + entry.name + ", " + entry.providerName)
        }
        .background(selected ? theme.fill2.color : highlighted ? theme.fill1.color : .clear, in: RoundedRectangle(cornerRadius: Radius.card))
    }

    private func moveCursor(to index: Int) {
        cursor = min(max(0, index), max(0, entries.count - 1))
        if entries.indices.contains(cursor) { scrollTarget = entries[cursor].id }
    }

    private func providerButton(_ id: String, name: String, @ViewBuilder icon: () -> some View) -> some View {
        Button { filter = id; query = "" } label: {
            icon().appFont(.system(size: 15)).foregroundStyle(filter == id ? theme.accent.color : theme.text2.color)
                .frame(width: 32, height: 30).background(filter == id ? theme.fill3.color : .clear, in: RoundedRectangle(cornerRadius: Radius.card))
        }.buttonStyle(.plain).help(name).accessibilityLabel("Show " + name)
            .accessibilityAddTraits(filter == id ? .isSelected : [])
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !setsDefault {
                Button {
                    guard isCurrentChat else { close(); return }
                    model.chooseChatModel(provider: nil, model: nil); close()
                } label: {
                    Label("Use app / project default", systemImage: "arrow.uturn.backward")
                }.buttonStyle(.plain).accessibilityLabel("Use default model for this chat")
            }
            if !custom {
                Button { custom = true; focused = .custom } label: { Label("Custom model…", systemImage: "plus") }.buttonStyle(.plain)
            }
            Text(setsDefault ? "New chats and voice use this model." : "Applies to the next turn in this chat.").appFont(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }.appFont(.system(size: 12)).foregroundStyle(theme.text2.color).padding(12)
    }

    private var customForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { custom = false; focused = .search } label: { Label("Models", systemImage: "chevron.left") }.buttonStyle(.plain)
            Text("Custom model").appFont(.system(size: 14, weight: .medium))
            Text(customProvider?.name ?? "Choose a provider").appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            TextField("Model id", text: $customId).textFieldStyle(.roundedBorder).focused($focused, equals: .custom)
                .accessibilityLabel("Custom model id").onSubmit { chooseCustom() }
            Text("Use the provider buttons to choose where this model runs. Model availability is checked by that provider when you send.")
                .appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
            Button("Use model", action: chooseCustom).disabled(customProvider?.available != true || !ModelInfo.isValidModelId(customId.trimmingCharacters(in: .whitespaces)))
            Spacer(minLength: 0)
        }.padding(16)
    }

    private var isCurrentChat: Bool { chat == nil || chat == (model.chats?.current ?? "") }

    private func choose(_ entry: ModelPickerEntry) {
        guard isCurrentChat else { close(); return }
        guard entry.available else { return }
        if setsDefault { model.chooseModel(provider: entry.provider, model: entry.model); close(); return }
        model.chooseChatModel(provider: entry.provider, model: entry.model); close()
    }

    private func chooseCustom() {
        guard isCurrentChat else { close(); return }
        let id = customId.trimmingCharacters(in: .whitespaces)
        guard let provider = customProvider, provider.available, ModelInfo.isValidModelId(id) else { return }
        if setsDefault { model.chooseModel(provider: provider.id, model: id); close(); return }
        model.chooseChatModel(provider: provider.id, model: id); close()
    }
}
