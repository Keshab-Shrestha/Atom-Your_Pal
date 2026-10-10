import SwiftUI
import ZenoIslandCore

/// The panel under the menu-bar icon (ADR-038, ADR-040, ADR-056, ADR-057): a header with ZENO's state, then tabs
/// for the conversation, ZENO's status and Settings. Every colour comes from the user's theme.
struct ExpandedView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                StateGlyph(kind: model.status.kind)
                    .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.status.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text.color)
                    if !model.status.detail.isEmpty {
                        Text(model.status.detail)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.text2.color)
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 4)
                if model.status.showsLevel {
                    Waveform(levels: model.meter.history, color: theme.live.color)
                        .frame(width: 46, height: 20)
                }
                IconButton(symbol: "xmark", label: "Close (Esc)") { model.setExpanded(false) }
            }
            .padding(.horizontal, 12)
            .padding(.top, 11)
            .padding(.bottom, 9)

            TabBar(selection: Binding(get: { model.tab }, set: { model.tab = $0 }))
                .padding(.horizontal, 12)
                .padding(.bottom, 9)

            Rectangle().fill(theme.separator.color).frame(height: 0.5)

            Group {
                switch model.tab {
                case .conversation: ConversationTab(model: model)
                case .status: StatusTab(model: model)
                case .settings: SettingsTab(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: - Building blocks

private struct SnapshotKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// Rendering for a development snapshot: `ImageRenderer` cannot draw scroll views.
    var islandSnapshot: Bool {
        get { self[SnapshotKey.self] }
        set { self[SnapshotKey.self] = newValue }
    }
}

/// A vertical scroll view, laid out flat in development snapshots.
struct Scrollable<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            // Natural height, pinned to the top; anything taller is cut off at the bottom like an unscrolled
            // list. GeometryReader takes only the space offered, so tall content cannot push the header out.
            GeometryReader { proxy in
                content.fixedSize(horizontal: false, vertical: true)
                    .frame(width: proxy.size.width, alignment: .top)
            }
            .clipped()
        } else {
            ScrollView { content }.scrollIndicators(.automatic)
        }
    }
}

/// A segmented control in the theme: the selected segment is a raised pill.
struct TabBar: View {
    @Binding var selection: IslandModel.Tab
    @Namespace private var namespace
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 2) {
            ForEach(IslandModel.Tab.allCases) { tab in
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { selection = tab }
                } label: {
                    Text(tab.rawValue)
                        .font(.system(size: 11.5, weight: selection == tab ? .semibold : .medium))
                        .foregroundStyle(selection == tab ? theme.text.color : theme.text2.color)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background {
                            if selection == tab {
                                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                                    .fill(theme.isDark ? theme.fill3.color : Color.white)
                                    .shadow(color: .black.opacity(theme.isDark ? 0 : 0.08), radius: 1.5, y: 0.5)
                                    .matchedGeometryEffect(id: "tab", in: namespace)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill1.color))
    }
}
