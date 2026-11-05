import SwiftUI
import ArkIslandCore

/// The sidebar's apps (2026-11-05): each app ARK made for you, under the agents. A click opens it in the window; + asks ARK to make one.
/// A new app shows here as soon as you approve it. "All apps" opens the Apps page, where an app is removed.
struct SidebarApps: View {
    let model: IslandModel
    /// The most rows before "All apps".
    static let shown = 5
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let apps = model.apps ?? []
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Apps").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                Spacer()
                Button { model.askForApp() } label: {
                    Glyph(systemName: "plus").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                        .frame(width: 22, height: 22).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Ask ARK to make an app").accessibilityLabel("New app")
            }
            .padding(.horizontal, 8)
            ForEach(apps.prefix(Self.shown)) { app in AppRow(model: model, app: app) }
            if apps.count > Self.shown {
                Button("All \(apps.count) apps") { model.navigate { model.windowPage = .apps; model.closeAppPage() } }
                    .buttonStyle(.plain).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).padding(.horizontal, 8).padding(.top, 2)
            }
        }
        .padding(.top, 8)
        .onAppear { if !snapshot, model.apps == nil { model.send(.appsList) } }
    }
}

private struct AppRow: View {
    let model: IslandModel
    let app: AppItem
    @State private var hovering = false
    @Environment(\.theme) private var theme

    var body: some View {
        let open = model.windowPage == .apps && model.openApp?.id == app.id
        Button { model.navigate { model.windowPage = .apps; model.openAppPage(app.id) } } label: {
            HStack(spacing: 8) {
                Glyph(systemName: "app.dashed").appFont(.system(size: 12)).foregroundStyle(theme.text2.color).frame(width: 18, height: 18)
                Text(app.name).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: Radius.card).fill(open ? theme.fill2.color : hovering ? theme.fill1.color : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(app.description.isEmpty ? app.name : "\(app.name): \(app.description)")
        .accessibilityLabel(app.name)
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}
