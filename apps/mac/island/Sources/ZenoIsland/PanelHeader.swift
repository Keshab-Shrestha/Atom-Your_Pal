import SwiftUI
import ZenoIslandCore

// ADR-084 (Lantern, Task 4.3): the panel's header is Pal itself, live in its current mood, with the state in
// rounded type and the model under it. Tabs are words with Pal's light lying under the selected one, and the
// light falls from Pal across the top of the panel, brighter or breathing with the state.

/// Where the header's Pal sits, from the panel's top-left corner: the centre of its 38 pt slot. The glow is
/// centred here so the light comes from Pal.
private enum HeaderLayout {
    static let padding = EdgeInsets(top: 14, leading: Spacing.panel, bottom: 8, trailing: Spacing.panel)
    static let palSlot: CGFloat = 38
    static let palSize: CGFloat = 34
    static var palCentre: CGPoint { CGPoint(x: padding.leading + palSlot / 2, y: padding.top + palSlot / 2) }
}

/// Pal, the state and model, Helpers and Close; then the tabs.
struct PanelHeader: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                HeaderPal(kind: model.status.kind)
                    .frame(width: HeaderLayout.palSlot, height: HeaderLayout.palSlot)
                stateText
                Spacer(minLength: 4)
                if model.status.showsLevel {
                    Waveform(levels: model.meter.history, color: theme.live.color)
                        .frame(width: 46, height: 20)
                        .transition(.opacity)
                }
                IconButton(symbol: "person.2", label: "Helpers", diameter: 26) { model.openHelpers() }
                IconButton(symbol: "xmark", label: "Close (Esc)", diameter: 26) { model.setExpanded(false) }
            }
            HStack(alignment: .top, spacing: 8) {
                WordTabs(selection: Binding(get: { model.tab }, set: { model.tab = $0 }))
                // ADR-084: "New conversation" is a pencil beside the tabs, there once a conversation has begun.
                if model.tab == .conversation, !model.conversation.isEmpty {
                    PencilButton { model.newConversation() }
                        .transition(.opacity)
                }
            }
        }
        .padding(HeaderLayout.padding)
    }

    /// The state in SF Pro Rounded, and under it the detail, or the model when the state has none to add.
    private var stateText: some View {
        let detail = model.status.detail.isEmpty ? model.status.modelName : model.status.detail
        let showsModel = !detail.isEmpty && detail == model.status.modelName
        return VStack(alignment: .leading, spacing: 1) {
            Text(model.status.title)
                .font(.system(size: 15, weight: .semibold, design: theme.titleDesign))
                .foregroundStyle(theme.text.color)
                .contentTransition(.opacity)
            if !detail.isEmpty {
                // The model is an identifier: SF Mono in Void's violet.
                Text(detail)
                    .font(showsModel ? theme.idFont(.system(size: 11.5), size: 11) : .system(size: 11.5))
                    .foregroundStyle(showsModel ? theme.idColor(theme.text2) : theme.text2.color)
                    .contentTransition(.opacity)
            }
        }
        .lineLimit(1)
        .animation(.easeOut(duration: 0.18), value: model.status.title)
        .accessibilityElement(children: .combine)
    }
}

/// A bare glyph button (no disc) for the tab row: brightens and gains a soft round fill on hover.
private struct PencilButton: View {
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(hovering.wrappedValue ? theme.text.color : theme.text2.color)
                .frame(width: 26, height: 26)
                .background {
                    if theme.isGhost {
                        Circle().strokeBorder(theme.hairline(true), lineWidth: 1).opacity(hovering.wrappedValue ? 1 : 0)
                    } else {
                        Circle().fill(hovering.wrappedValue ? theme.fill1.color : .clear)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .offset(y: -5) // centred on the tab words, not on the words and the light under them
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.hover(reduceMotion, ghost: theme.isGhost), value: hovering.wrappedValue)
        .help("New conversation")
        .accessibilityLabel("New conversation")
    }
}

/// Pal in the header, showing the mood the pet shows for this state. It moves while the
/// panel is open; held still in snapshots and with Reduce Motion.
private struct HeaderPal: View {
    let kind: IslandStatus.Kind
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let mood = PetBrain.mood(for: kind) ?? .resting
        TimelineView(.animation(minimumInterval: 1 / 30, paused: snapshot || reduceMotion)) { context in
            let time = snapshot || reduceMotion ? 0.45 : context.date.timeIntervalSinceReferenceDate
            PalView(mood: mood, time: time, facing: 1, size: HeaderLayout.palSize)
        }
        .accessibilityHidden(true) // the state beside it says the same in words
    }
}

/// The light from the header's Pal falling across the panel: a radial glow in the theme's glow colour, as bright
/// as the state asks (`PanelLight`), easing between levels and breathing while listening or thinking.
struct PanelGlow: View {
    let kind: IslandStatus.Kind
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if theme.usesGlow { glow }
    }

    private var glow: some View {
        let light = PanelLight(kind)
        let colour = theme.glow.with(alpha: 1).color
        let breathe = light.breath == .still || snapshot ? nil : Motion.breathe(reduceMotion, slow: light.breath == .slow)
        return Circle()
            .fill(RadialGradient(colors: [colour, colour.opacity(0.28), colour.opacity(0)], center: .center, startRadius: 2, endRadius: 280))
            .frame(width: 560, height: 560)
            .opacity(light.brightness * theme.glow.a)
            .breathing(breathe)
            .animation(Motion.glow(reduceMotion), value: light.brightness)
            .position(HeaderLayout.palCentre)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private extension View {
    /// Dims and brightens a little, on repeat, with `animation` as each half-breath. Nil holds it still.
    @ViewBuilder func breathing(_ animation: Animation?) -> some View {
        if let animation {
            phaseAnimator([1.0, 0.68]) { content, phase in content.opacity(phase) } animation: { _ in animation }
        } else {
            self
        }
    }
}

/// The tabs as words. The selected word is bright and a small bar of Pal's light lies under it, sliding to the
/// next word on the settle spring; the others brighten on hover.
struct WordTabs: View {
    @Binding var selection: IslandModel.Tab
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 20) {
            ForEach(IslandModel.Tab.allCases) { tab in
                WordTab(title: tab.rawValue, selected: selection == tab, namespace: namespace) {
                    withAnimation(Motion.settle(reduceMotion)) { selection = tab }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct WordTab: View {
    let title: String
    let selected: Bool
    let namespace: Namespace.ID
    let action: () -> Void
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let light = theme.glow.a > 0 ? theme.glow.with(alpha: 1).color : theme.accent.color
        Button(action: action) {
            VStack(spacing: 6) {
                // Both weights are laid out so the word does not shift when it becomes selected.
                ZStack {
                    Text(title).font(.system(size: 12.5, weight: .semibold)).hidden()
                    Text(title)
                        .font(.system(size: 12.5, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? theme.text.color : (hovering.wrappedValue ? theme.text2.color : theme.text3.color))
                }
                ZStack {
                    Capsule().fill(.clear).frame(width: 16, height: 2.5)
                    if selected {
                        Capsule()
                            .fill(theme.isDark ? light : theme.accent.color)
                            .frame(width: 16, height: 2.5)
                            .shadow(color: light.opacity(theme.usesGlow ? (theme.isDark ? 0.9 : 0.7) : 0), radius: 4)
                            .matchedGeometryEffect(id: "light", in: namespace)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering.wrappedValue = $0 }
        .animation(Motion.snap(reduceMotion), value: hovering.wrappedValue)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
