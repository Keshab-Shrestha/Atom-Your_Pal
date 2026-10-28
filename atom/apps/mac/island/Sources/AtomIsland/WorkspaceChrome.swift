import AppKit
import SwiftUI
import AtomIslandCore

/// The four-lane reference translated into native controls and existing navigation commands.
struct WorkspaceNavigationRail: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @State private var dragging: SidebarItem?

    private var layout: Binding<SidebarLayout> {
        Binding(get: { model.settings.sidebar }, set: { model.settings.sidebar = $0 })
    }

    var body: some View {
        VStack(spacing: 12) {
            WorkspaceRailButton(title: "Home", symbol: "house", selected: model.windowPage == .dashboard,
                                badge: 0, appIcon: true) {
                model.navigate { model.windowPage = .dashboard }
            }
            Scrollable {
                VStack(spacing: 6) {
                    railButton("Chats", symbol: "bubble.left.and.text.bubble.right", selected: model.windowPage == .chat) {
                        model.navigate { model.windowPage = .chat }
                    }
                    pages(model.settings.sidebar.top, bottom: false)
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 6) {
                pages(model.settings.sidebar.bottom, bottom: true)
            }
        }
        .padding(.vertical, 10).frame(width: 51)
        .workspaceLane(color: WorkspaceColors.for(model.settings.theme).rail)
        .accessibilityElement(children: .contain).accessibilityLabel("Main navigation")
    }

    @ViewBuilder private func pages(_ items: [SidebarItem], bottom: Bool) -> some View {
        ForEach(items.filter { $0 != .dashboard }, id: \.self) { item in
            if snapshot { pageButton(item) }
            else {
                pageButton(item)
            .contextMenu {
                Button("Move up") { shift(item, in: items, by: -1) }
                Button("Move down") { shift(item, in: items, by: 1) }
                Button(bottom ? "Move to the top group" : "Move to the bottom group") {
                    model.settings.sidebar.move(item, before: nil, toBottom: !bottom)
                }
            }
            .onDrag { dragging = item; return NSItemProvider(object: item.rawValue as NSString) }
            .onDrop(of: [.text], delegate: SidebarDrop(target: item, toBottom: bottom,
                dragging: $dragging, layout: layout))
            }
        }
        if !snapshot {
            Color.clear.frame(height: 4)
                .onDrop(of: [.text], delegate: SidebarDrop(target: nil, toBottom: bottom, dragging: $dragging, layout: layout))
        }
    }

    private func shift(_ item: SidebarItem, in items: [SidebarItem], by step: Int) {
        let visible = items.filter { $0 != .dashboard }
        guard let from = visible.firstIndex(of: item), visible.indices.contains(from + step) else { return }
        model.settings.sidebar.move(item, onto: visible[from + step])
    }

    private func pageButton(_ item: SidebarItem) -> some View {
        let entry = destination(item)
        return railButton(entry.title, symbol: entry.symbol, selected: entry.selected,
                       badge: item == .board ? BoardAttention(list: model.helpers.list, approvalPending: model.approval.pending != nil).total : 0) {
                model.navigate {
                    switch item {
                    case .dashboard: model.windowPage = .dashboard
                    case .board:
                        model.windowPage = .agents; model.helpers.selectBoard()
                        model.boardView = BoardAttention(list: model.helpers.list, approvalPending: model.approval.pending != nil).view(whenOpening: model.boardView)
                    case .scheduled: model.windowPage = .scheduled
                    case .brain: model.windowPage = .brain
                    case .plugins: model.windowPage = .plugins
                    case .settings: model.windowPage = .settings
                    }
                }
            }

    }

    private func destination(_ item: SidebarItem) -> (title: String, symbol: String, selected: Bool) {
        switch item {
        case .dashboard: ("Dashboard", "chart.bar.xaxis", model.windowPage == .dashboard)
        case .board: ("Board", "rectangle.split.3x1", model.windowPage == .agents)
        case .scheduled: ("Scheduled", "calendar", model.windowPage == .scheduled)
        case .brain: ("Second brain", "brain.head.profile", model.windowPage == .brain)
        case .plugins: ("Plugins", "puzzlepiece.extension", model.windowPage == .plugins)
        case .settings: ("Settings", "gearshape", model.windowPage == .settings)
        }
    }

    private func railButton(_ title: String, symbol: String, selected: Bool, badge: Int = 0,
                            action: @escaping () -> Void) -> some View {
        WorkspaceRailButton(title: title, symbol: symbol, selected: selected, badge: badge, action: action)
    }
}

/// Names stay visible so destinations are recognizable without memorizing glyphs or hovering.
private struct WorkspaceRailButton: View {
    let title: String
    let symbol: String
    let selected: Bool
    let badge: Int
    var appIcon = false
    let action: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    private static let homeIconSize: CGFloat = 25.5

    private var caption: String {
        switch title {
        case "Second brain": "Brain"
        case "Scheduled": "Schedule"
        default: title
        }
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: appIcon ? 1 : 5) {
                if appIcon {
                    homeIcon.frame(width: Self.homeIconSize, height: Self.homeIconSize).accessibilityHidden(true)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 14.25, weight: selected ? .semibold : .medium))
                        .symbolRenderingMode(.hierarchical)
                        .frame(height: 18)
                }
                Text(caption).appFont(.system(size: 8.5, weight: selected ? .semibold : .medium))
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? theme.accent.color : hovering ? theme.text.color : theme.text2.color)
            .frame(width: 43, height: 54)
            .background(selected ? theme.accent.color.opacity(0.15) : hovering ? theme.fill2.color : .clear,
                        in: RoundedRectangle(cornerRadius: 11))
            .overlay(alignment: .topTrailing) {
                if badge > 0 {
                    Text(badge > 9 ? "9+" : String(badge)).appFont(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.onAttention.color).padding(3).background(theme.attention.color, in: Capsule())
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(WorkspacePressStyle())
        .onHover { hovering = $0 }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovering)
        .help(appIcon ? "Home — Dashboard" : title).accessibilityLabel(badge > 0 ? "\(title), \(badge) need attention" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var homeIcon: some View {
        if let url = Bundle.main.url(forResource: "ATOM", withExtension: "icns"),
           let icon = NSImage(contentsOf: url) {
            Image(nsImage: icon).resizable().interpolation(.high).scaledToFit()
        } else {
            // The standalone gallery has no app bundle; use the artwork that generates the bundled icon.
            AppIconArt.icon.scaleEffect(Self.homeIconSize / AppIconArt.size)
                .frame(width: Self.homeIconSize, height: Self.homeIconSize)
        }
    }
}

/// Press feedback starts on mouse-down. Native buttons keep release/cancel and keyboard semantics.
struct WorkspacePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.72 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 1), value: configuration.isPressed)
    }
}

private struct WorkspaceLane: ViewModifier {
    let color: RGBA
    @Environment(\.theme) private var theme
    @Environment(\.colorSchemeContrast) private var contrast
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        content.background(color.color)
            .clipShape(shape)
            .overlay(shape.strokeBorder(contrast == .increased ? theme.text3.color : theme.separator.color,
                                       lineWidth: contrast == .increased ? 1.5 : 0.5))
    }
}

extension View {
    func workspaceLane(color: RGBA) -> some View { modifier(WorkspaceLane(color: color)) }
}
