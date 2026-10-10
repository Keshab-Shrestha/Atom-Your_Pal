import SwiftUI
import ZenoIslandCore

/// Settings as a short list of pages (ADR-057). Each page holds one area, with the right control per setting:
/// switches for on/off, segmented pickers for two to four short choices, pop-up menus for longer lists.
struct SettingsTab: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let page = model.settingsPage {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) { model.settingsPage = nil }
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
                    Text(page.rawValue).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
                    Spacer()
                    Color.clear.frame(width: 64, height: 1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                Scrollable {
                    VStack(alignment: .leading, spacing: 14) { pageContent(page) }
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                        .padding(.top, 2)
                }
            }
            .transition(.move(edge: .trailing).combined(with: .opacity))
        } else {
            Scrollable {
                VStack(alignment: .leading, spacing: 14) {
                    Card {
                        ForEach(Array(IslandModel.SettingsPage.allCases.enumerated()), id: \.element) { index, page in
                            if index > 0 { RowDivider() }
                            PageRow(page: page, summary: summary(page)) {
                                withAnimation(.easeOut(duration: 0.18)) { model.settingsPage = page }
                            }
                        }
                    }
                }
                .padding(12)
            }
            .transition(.opacity)
        }
    }

    /// The current value shown on a page's row, so the list answers "how is it set?" without opening anything.
    private func summary(_ page: IslandModel.SettingsPage) -> String {
        let s = model.settings
        switch page {
        case .examples: return model.capabilities.map { $0.count == 1 ? "1 tool" : "\($0.count) tools" } ?? ""
        case .appearance: return "\(s.theme.title) · \(s.wispStyle.title)"
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

/// One row in the Settings list: a coloured icon tile, the page name, its current value and a chevron.
private struct PageRow: View {
    let page: IslandModel.SettingsPage
    let summary: String
    let action: () -> Void
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: page.symbol)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(theme.onAccent.color)
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(theme.accentFill))
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
            .padding(.horizontal, 11)
            .frame(height: 38)
            .background(hovering.wrappedValue ? theme.fill1.color : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .accessibilityLabel("\(page.rawValue), \(summary)")
    }
}
