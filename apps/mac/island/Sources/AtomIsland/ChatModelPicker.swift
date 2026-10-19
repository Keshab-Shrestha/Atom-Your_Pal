import SwiftUI
import AtomIslandCore

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
                HStack(spacing: 5) {
                    Image(systemName: ModelProviderSymbol.name(provider)).font(.system(size: 11))
                    Text(value + "  ⌄").font(.system(size: 12)).lineLimit(1)
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
    var close: () -> Void
    @State private var query = ""
    @State private var filter = "all"
    @State private var cursor = 0
    @State private var custom = false
    @State private var customId = ""
    @FocusState private var focused: Field?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private enum Field: Hashable { case search, custom }

    private var currentProvider: String { model.chats?.currentProvider ?? info.provider }
    private var currentModel: String { model.chats?.currentModel ?? info.model }
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
            VStack(spacing: 6) {
                providerButton("all", name: "All models", symbol: "square.grid.2x2")
                providerButton("favorites", name: "Favorites", symbol: "star.fill")
                Rectangle().fill(theme.border.color).frame(height: 1).padding(.vertical, 2)
                ForEach(info.providers) { provider in
                    providerButton(provider.id, name: provider.name, symbol: ModelProviderSymbol.name(provider.id))
                }
                Spacer(minLength: 0)
            }.padding(6).frame(width: 44).background(theme.fill1.color)
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
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(theme.text3.color)
            if snapshot { Text("Search models…").foregroundStyle(theme.text3.color); Spacer() }
            else {
                TextField("Search models…", text: $query).textFieldStyle(.plain).focused($focused, equals: .search)
                    .onSubmit { if !entries.isEmpty { choose(entries[min(cursor, entries.count - 1)]) } }
                    .onKeyPress(.downArrow) { cursor = min(cursor + 1, max(0, entries.count - 1)); return .handled }
                    .onKeyPress(.upArrow) { cursor = max(0, cursor - 1); return .handled }
                    .accessibilityLabel("Search models")
            }
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain).accessibilityLabel("Clear model search")
            }
        }.font(.system(size: 13)).padding(12)
    }

    @ViewBuilder private var modelList: some View {
        if snapshot {
            Scrollable { VStack(alignment: .leading, spacing: 2) { modelRows }.padding(6) }
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) { modelRows }.padding(6)
                }
                .onChange(of: cursor) {
                    if entries.indices.contains(cursor) { proxy.scrollTo(entries[cursor].id, anchor: .center) }
                }
            }
        }
    }

    @ViewBuilder private var modelRows: some View {
        if entries.isEmpty {
            Text(filter == "favorites" && query.isEmpty ? "Star a model to keep it here." : "No matching models.")
                .font(.system(size: 12)).foregroundStyle(theme.text3.color).padding(14)
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
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.name).font(.system(size: 12.5, weight: selected ? .medium : .regular)).foregroundStyle(theme.text.color).lineLimit(2)
                        Text(entry.providerName + (entry.available ? "" : " · Unavailable on this Mac"))
                            .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if selected { Image(systemName: "checkmark").font(.system(size: 10)).foregroundStyle(theme.accent.color) }
                }.padding(.leading, 9).padding(.vertical, 8).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(!entry.available)
                .accessibilityLabel(entry.name + ", " + entry.providerName + (entry.available ? "" : ", unavailable"))
                .accessibilityAddTraits(selected ? .isSelected : [])
            Button { model.settings.toggleFavoriteModel(provider: entry.provider, model: entry.model) } label: {
                Image(systemName: favorite ? "star.fill" : "star").font(.system(size: 11))
                    .foregroundStyle(favorite ? theme.accent.color : theme.text3.color).frame(width: 26, height: 28)
            }.buttonStyle(.plain).padding(.trailing, 4)
                .disabled(!favorite && model.settings.favoriteModels.count >= 128)
                .accessibilityLabel((favorite ? "Unstar " : "Star ") + entry.name + ", " + entry.providerName)
        }
        .background(selected ? theme.fill2.color : highlighted ? theme.fill1.color : .clear, in: RoundedRectangle(cornerRadius: 6))
    }

    private func providerButton(_ id: String, name: String, symbol: String) -> some View {
        Button { filter = id; query = "" } label: {
            Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(filter == id ? theme.accent.color : theme.text2.color)
                .frame(width: 32, height: 30).background(filter == id ? theme.fill3.color : .clear, in: RoundedRectangle(cornerRadius: 6))
        }.buttonStyle(.plain).help(name).accessibilityLabel("Show " + name)
            .accessibilityAddTraits(filter == id ? .isSelected : [])
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                guard isCurrentChat else { close(); return }
                model.chooseChatModel(provider: nil, model: nil); close()
            } label: {
                Label("Use app / project default", systemImage: "arrow.uturn.backward")
            }.buttonStyle(.plain).accessibilityLabel("Use default model for this chat")
            if !custom {
                Button { custom = true; focused = .custom } label: { Label("Custom model…", systemImage: "plus") }.buttonStyle(.plain)
            }
            Text("Applies to the next turn in this chat.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
        }.font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(12)
    }

    private var customForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { custom = false; focused = .search } label: { Label("Models", systemImage: "chevron.left") }.buttonStyle(.plain)
            Text("Custom model").font(.system(size: 14, weight: .medium))
            Text(customProvider?.name ?? "Choose a provider").font(.system(size: 12)).foregroundStyle(theme.text2.color)
            TextField("Model id", text: $customId).textFieldStyle(.roundedBorder).focused($focused, equals: .custom)
                .accessibilityLabel("Custom model id").onSubmit { chooseCustom() }
            Text("Use the provider buttons to choose where this model runs. Model availability is checked by that provider when you send.")
                .font(.system(size: 11)).foregroundStyle(theme.text3.color)
            Button("Use model", action: chooseCustom).disabled(customProvider?.available != true || !ModelInfo.isValidModelId(customId.trimmingCharacters(in: .whitespaces)))
            Spacer(minLength: 0)
        }.padding(14)
    }

    private var isCurrentChat: Bool { chat == nil || chat == (model.chats?.current ?? "") }

    private func choose(_ entry: ModelPickerEntry) {
        guard isCurrentChat else { close(); return }
        guard entry.available else { return }
        model.chooseChatModel(provider: entry.provider, model: entry.model); close()
    }

    private func chooseCustom() {
        guard isCurrentChat else { close(); return }
        let id = customId.trimmingCharacters(in: .whitespaces)
        guard let provider = customProvider, provider.available, ModelInfo.isValidModelId(id) else { return }
        model.chooseChatModel(provider: provider.id, model: id); close()
    }
}
