import SwiftUI
import ArkIslandCore

/// Panels (2026-11-02, after Empryo's "Morphs"): panels the agent made for you, or you asked for. Each is a card of blocks you use
/// directly: tick, add, count, and click buttons. Nothing runs by itself. 2026-11-06: they live on the Apps page as simple apps
/// (AppsPane), and in the rail; a new one is asked for in a chat, and ARK adds it after you approve it.

/// The panels pinned to Home, under the tiles.
struct HomePanels: View {
    let model: IslandModel

    var body: some View {
        let pinned = (model.panels?.panels ?? []).filter { $0.enabled && $0.home }
        if !pinned.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(pinned) { panel in PanelCard(model: model, panel: panel, manage: false) }
            }
        }
    }
}

/// One panel: its name, its blocks, and (on the Panels page) Pin, On or off and Delete.
struct PanelCard: View {
    let model: IslandModel
    let panel: Panel
    let manage: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let live = model.panelLive
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(panel.name).appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                if !panel.enabled { Text("Off").appFont(.system(size: 11)).foregroundStyle(theme.text3.color).padding(.horizontal, 7).background(Capsule().fill(theme.fill2.color)) }
                if panel.home && manage { Glyph(systemName: "pin.fill").appFont(.system(size: 10)).foregroundStyle(theme.text3.color).accessibilityLabel("Pinned to Home") }
                Spacer()
                if manage { menu }
            }
            ForEach(Array(panel.blocks.enumerated()), id: \.offset) { index, block in
                PanelBlockView(model: model, panel: panel, index: index, block: block, live: live).opacity(panel.enabled ? 1 : 0.45)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
    }

    @ViewBuilder private var menu: some View {
        if snapshot { Glyph(systemName: "ellipsis").foregroundStyle(theme.text3.color).frame(width: 24, height: 24) } // snapshots draw no menus
        else { optionsMenu }
    }

    private var optionsMenu: some View {
        Menu {
            Button(panel.home ? "Unpin from Home" : "Pin to Home") { change { $0.home.toggle() } }
            Button(panel.enabled ? "Turn off" : "Turn on") { change { $0.enabled.toggle() } }
            Divider()
            Button("Delete", role: .destructive) { model.send(.panelDelete(id: panel.id)) }
        } label: {
            Glyph(systemName: "ellipsis").foregroundStyle(theme.text3.color).frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel("Panel options")
    }

    private func change(_ edit: (inout Panel) -> Void) {
        var changed = panel
        edit(&changed)
        model.send(.panelSave(changed))
    }
}

/// One block. A block's own state (a tick, a note, a count) is changed here and saved with the whole panel.
private struct PanelBlockView: View {
    let model: IslandModel
    let panel: Panel
    let index: Int
    let block: Panel.Block
    let live: [String: Int]
    @State private var draft = ""
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        switch block.kind {
        case "text": Text(block.text ?? "").appFont(.system(size: 13)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
        case "stat": stat
        case "progress": progress
        case "counter": counter
        case "checklist", "notes": list
        case "chart": chart
        case "button": button
        default: EmptyView()
        }
    }

    private func label(_ text: String?) -> some View {
        Group { if let text, !text.isEmpty { Text(text).appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color) } }
    }

    private var stat: some View {
        VStack(alignment: .leading, spacing: 2) {
            label(block.label)
            Text(PanelTemplate.render(block.value ?? "", live: live)).appFont(.system(size: 26, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
            if let detail = block.detail { Text(detail).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color) }
        }
    }

    private var progress: some View {
        let shown = PanelTemplate.render(block.value ?? "", live: live)
        let fraction = PanelTemplate.fraction(value: block.value ?? "", max: block.max, live: live)
        return VStack(alignment: .leading, spacing: 5) {
            HStack { label(block.label); Spacer(); Text("\(shown) / \(PanelEdit.number(block.max ?? 100))").appFont(.system(size: 11.5)).monospacedDigit().foregroundStyle(theme.text3.color) }
            GeometryReader { box in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.fill3.color)
                    Capsule().fill(theme.accent.color).frame(width: box.size.width * fraction)
                }
            }.frame(height: 6)
        }
        .accessibilityElement(children: .ignore).accessibilityLabel("\(block.label ?? "Progress"), \(shown) of \(PanelEdit.number(block.max ?? 100))")
    }

    private var counter: some View {
        HStack(spacing: 10) {
            label(block.label)
            Spacer()
            stepper("minus", "Less", -1)
            Text(PanelEdit.number(block.count ?? 0)).appFont(.system(size: 18, weight: .semibold)).monospacedDigit().frame(minWidth: 36)
            stepper("plus", "More", 1)
        }
    }

    private func stepper(_ symbol: String, _ name: String, _ sign: Double) -> some View {
        Button { save { $0.count = ($0.count ?? 0) + sign * ($0.step ?? 1) } } label: {
            Glyph(systemName: symbol).appFont(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text.color)
                .frame(width: 26, height: 26).background(Circle().fill(theme.fill2.color))
        }.buttonStyle(.plain).accessibilityLabel("\(name): \(block.label ?? "counter")")
    }

    private var list: some View {
        let checks = block.kind == "checklist"
        let items = block.items ?? []
        return VStack(alignment: .leading, spacing: 6) {
            label(block.label)
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                HStack(spacing: 8) {
                    if checks {
                        Button { save { $0.items?[i].done = !(item.done ?? false) } } label: {
                            Glyph(systemName: item.done == true ? "checkmark.square.fill" : "square").foregroundStyle(item.done == true ? theme.accent.color : theme.text3.color)
                        }.buttonStyle(.plain).accessibilityLabel("\(item.text), \(item.done == true ? "done" : "not done")")
                    } else {
                        Text("•").foregroundStyle(theme.text3.color)
                    }
                    Text(item.text).appFont(.system(size: 13)).strikethrough(checks && item.done == true)
                        .foregroundStyle(checks && item.done == true ? theme.text3.color : theme.text.color).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Button { save { $0.items?.remove(at: i) } } label: { Glyph(systemName: "xmark").appFont(.system(size: 9)).foregroundStyle(theme.text3.color) }
                        .buttonStyle(.plain).accessibilityLabel("Remove \(item.text)")
                }
            }
            if !snapshot, items.count < 50 {
                TextField(checks ? "Add an item" : "Add a note", text: $draft).textFieldStyle(.plain).appFont(.system(size: 12.5)).onSubmit(add)
                    .padding(.vertical, 5).overlay(alignment: .bottom) { Rectangle().fill(theme.separator.color).frame(height: 1) }
            }
        }
    }

    private func add() {
        let text = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
        guard !text.isEmpty else { return }
        draft = ""
        save { $0.items = ($0.items ?? []) + [Panel.Item(text: text, done: block.kind == "checklist" ? false : nil)] }
    }

    @ViewBuilder private var chart: some View {
        if let spec = block.chart, let data = try? JSONEncoder().encode(spec), let json = String(data: data, encoding: .utf8), let parsed = ReplyChart.parse(json) {
            ReplyChartView(chart: parsed, copyEnabled: true)
        } else {
            Text("This chart could not be drawn.").appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
        }
    }

    private var button: some View {
        Button { model.runPanelAction(block.action) } label: {
            Text(block.label ?? "Go").appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
                .padding(.horizontal, 14).padding(.vertical, 7).background(Capsule().fill(theme.fill2.color))
        }
        .buttonStyle(.plain).help(PanelEdit.help(block.action))
    }

    /// Change this block and save the panel.
    private func save(_ edit: (inout Panel.Block) -> Void) {
        var changed = panel
        guard changed.blocks.indices.contains(index) else { return }
        edit(&changed.blocks[index])
        model.send(.panelSave(changed))
    }
}

/// Text for blocks and buttons.
enum PanelEdit {
    static func number(_ n: Double) -> String { n.rounded() == n && abs(n) < 1e15 ? String(Int64(n)) : String(format: "%.4g", n) }

    /// What a button does, for its tooltip: the user sees it before clicking.
    static func help(_ action: Panel.Action?) -> String {
        switch action?.kind {
        case "ask": "Starts a new chat with: " + (action?.prompt ?? "")
        case "open": "Opens " + (action?.page ?? "a page")
        case "workflow": "Runs the workflow " + (action?.id ?? "")
        default: ""
        }
    }
}
