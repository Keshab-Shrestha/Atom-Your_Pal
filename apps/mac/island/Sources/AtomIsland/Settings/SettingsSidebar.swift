import SwiftUI
import AtomIslandCore

/// T3-style contextual settings navigation (ADR-176). Filters local page names; it never changes a setting.
struct SettingsSidebar: View {
    let model: IslandModel
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    private let groups: [(String, [IslandModel.SettingsPage])] = SettingsHome.sidebar.map { ($0.title, $0.pages) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(theme.text3.color)
                if snapshot {
                    Text("Filter settings").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField("Filter settings", text: $query).textFieldStyle(.plain)
                        .accessibilityLabel("Filter settings categories")
                        .focused($searchFocused)
                        .onExitCommand { query = "" }
                }
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).accessibilityLabel("Clear settings filter")
                }
            }
            .appFont(.system(size: 12.5)).padding(.horizontal, 10).frame(height: 30)
            .background(theme.fill1.color, in: RoundedRectangle(cornerRadius: 8))
            Scrollable {
                if query.isEmpty {
                    category(title: "Overview", symbol: "slider.horizontal.3", selected: model.settingsPage == nil) { model.settingsPage = nil }
                }
                ForEach(groups, id: \.0) { title, pages in
                    let matches = pages.filter { query.isEmpty || $0.rawValue.localizedStandardContains(query) }
                    if !matches.isEmpty {
                        Text(title).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                            .padding(.horizontal, 10).padding(.top, 16).padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(matches) { page in
                            category(title: page.rawValue, symbol: page.symbol, selected: model.settingsPage == page) {
                                model.settingsPage = page
                            }
                        }
                    }
                }
                if !query.isEmpty && !groups.flatMap(\.1).contains(where: { $0.rawValue.localizedStandardContains(query) }) {
                    Text("No matching categories").appFont(.system(size: 12)).foregroundStyle(theme.text3.color).padding(10)
                }
            }
            .frame(maxHeight: .infinity)
            Button { model.navigate { model.windowPage = .chat } } label: {
                SidebarRow(symbol: "arrow.left", title: "Back to chats", detail: nil, selected: false)
            }.buttonStyle(.plain).accessibilityLabel("Back to chats")
        }
        .onChange(of: model.searchFocusTick) { searchFocused = true }
        .onAppear {
            guard model.searchFocusPending else { return }
            model.searchFocusPending = false
            DispatchQueue.main.async { searchFocused = true }
        }
    }

    private func category(title: String, symbol: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            SidebarRow(symbol: symbol, title: title, detail: nil, selected: selected)
        }.buttonStyle(.plain)
    }
}
