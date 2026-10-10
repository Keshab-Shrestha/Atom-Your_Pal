import SwiftUI
import ZenoIslandCore

/// Settings (ADR-057, ADR-084): home is the "now" card, then two groups of pages, each row with a monochrome glyph
/// and its current value. A page pushes in with the content hand-off; home cascades in the first time it shows
/// after the panel opens. Each page holds one area, with the right control per setting.
struct SettingsTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .top) {
            if let page = model.settingsPage {
                pageView(page).id(page).transition(Motion.handOff(reduceMotion))
            } else {
                home.transition(Motion.handOff(reduceMotion))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var home: some View {
        let cascade = !model.settingsCascaded
        return Scrollable {
            VStack(alignment: .leading, spacing: Spacing.wells) {
                NowCard(model: model).cascade(0, enabled: cascade)
                ForEach(Array(SettingsHome.groups.enumerated()), id: \.offset) { groupIndex, pages in
                    let before = 1 + SettingsHome.groups.prefix(groupIndex).map(\.count).reduce(0, +)
                    Card {
                        ForEach(Array(pages.enumerated()), id: \.element) { index, page in
                            if index > 0 { RowDivider(inset: PageRow.textInset) }
                            PageRow(page: page, summary: summary(page)) { open(page) }
                                .cascade(before + index, enabled: cascade)
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 10)
            .padding(.bottom, Spacing.panel)
        }
        .onAppear { model.settingsCascaded = true }
    }

    private func pageView(_ page: IslandModel.SettingsPage) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button {
                    withAnimation(Motion.settle(reduceMotion)) { model.settingsPage = nil }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "chevron.left").font(.system(size: 11, weight: .semibold))
                        Text("Settings").font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(theme.accent.color)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to Settings")
                Spacer()
                Text(page.rawValue).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(theme.text.color)
                Spacer()
                Color.clear.frame(width: 64, height: 1)
            }
            .padding(.horizontal, Spacing.panel)
            .padding(.top, 14)
            .padding(.bottom, 10)
            Scrollable {
                VStack(alignment: .leading, spacing: Spacing.wells) { pageContent(page) }
                    .padding(.horizontal, Spacing.panel)
                    .padding(.bottom, Spacing.panel)
                    .padding(.top, 4)
            }
        }
    }

    private func open(_ page: IslandModel.SettingsPage) {
        withAnimation(Motion.settle(reduceMotion)) { model.settingsPage = page }
    }

    /// The current value shown on a page's row, so the list answers "how is it set?" without opening anything.
    private func summary(_ page: IslandModel.SettingsPage) -> String {
        let s = model.settings
        switch page {
        case .examples: return model.capabilities.map { $0.count == 1 ? "1 tool" : "\($0.count) tools" } ?? ""
        case .appearance: return "\(s.theme.title), \(s.wispStyle.title)"
        case .model: return model.modelInfo?.currentModelName ?? "—"
        case .shortcuts: return s.shortcut(for: .talk)?.display ?? "Off"
        case .dictation: return s.dictationMode.title
        case .wisp: return s.petEnabled ? s.wispSize.title : "Off"
        case .memory:
            guard let memory = model.memory else { return "" }
            if !memory.enabled { return "Off" }
            return memory.count == 0 ? "Nothing kept" : memory.count == 1 ? "1 fact" : "\(memory.count) facts"
        case .general: return model.loginItem.enabled ? "Opens at login" : (s.soundsEnabled ? "Sounds on" : "Sounds off")
        }
    }

    @ViewBuilder private func pageContent(_ page: IslandModel.SettingsPage) -> some View {
        switch page {
        case .examples: ExamplesSection(model: model)
        case .appearance: AppearanceSection(model: model)
        case .model: ModelSection(model: model)
        case .shortcuts: ShortcutSection(model: model)
        case .dictation: DictationSection(model: model)
        case .wisp: WispSection(model: model)
        case .memory: MemorySection(model: model)
        case .general: GeneralSection(model: model)
        }
    }
}

/// One row in Settings home: a monochrome glyph, the page name, its current value and a chevron.
private struct PageRow: View {
    let page: IslandModel.SettingsPage
    let summary: String
    let action: () -> Void
    /// Where the row's name starts: the divider between rows begins here, under the words rather than the glyph.
    static let textInset = Spacing.well + glyphWidth + spacing
    private static let glyphWidth: CGFloat = 20
    private static let spacing: CGFloat = 12
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: Self.spacing) {
                Image(systemName: page.symbol)
                    .font(.system(size: 13))
                    .foregroundStyle(hovering.wrappedValue ? theme.text.color : theme.text2.color)
                    .frame(width: Self.glyphWidth)
                Text(page.rawValue)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(theme.text.color)
                Spacer(minLength: 6)
                Text(summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.text2.color)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, Spacing.well)
            .frame(height: 40)
            .background(hovering.wrappedValue ? theme.fill1.color : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.snap(reduceMotion), value: hovering.wrappedValue)
        .accessibilityLabel(summary.isEmpty ? page.rawValue : "\(page.rawValue), \(summary)")
    }
}

private extension View {
    /// Arrives with the cascade: row `index` settles in 30 ms after the one before (design study §3 A). Off in
    /// snapshots and with Reduce Motion, where everything is simply there.
    func cascade(_ index: Int, enabled: Bool) -> some View { modifier(Cascade(index: index, enabled: enabled)) }
}

private struct Cascade: ViewModifier {
    let index: Int
    let enabled: Bool
    private let shown = State(initialValue: false)
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let visible = shown.wrappedValue || !enabled || snapshot || reduceMotion
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 6)
            .onAppear {
                guard enabled, !shown.wrappedValue else { return }
                withAnimation(Motion.settle(reduceMotion).delay(Motion.cascadeDelay(row: index, reduceMotion))) { shown.wrappedValue = true }
            }
    }
}
