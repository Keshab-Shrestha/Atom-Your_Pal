import AppKit
import SwiftUI
import AtomIslandCore

/// Design system (ADR-124): ATOM's own components drawn in Void or Daylight (Showcase), and every token of
/// design/atom-design-system/tokens.css with its value, its Swift source and, for colours, its contrast (Tokens).
/// The page's own controls follow the app's theme; the preview below them is drawn in the theme it names, so the
/// two flat themes can be compared without changing the app's look.
struct DesignSection: View {
    let model: IslandModel
    @State private var mode: DesignShowcaseMode
    @State private var preview: DesignPreviewTheme
    @Environment(\.theme) private var theme

    init(model: IslandModel, mode: DesignShowcaseMode = .showcase, preview: DesignPreviewTheme? = nil) {
        self.model = model
        _mode = State(initialValue: mode)
        _preview = State(initialValue: preview ?? DesignPreviewTheme(current: model.settings.theme))
    }

    var body: some View {
        Card(footer: footer) {
            Row(title: "View") { Segmented(selection: mode) { new in mode = new } }
            RowDivider()
            Row(title: "Theme", detail: preview.theme.detail) { Segmented(selection: preview) { new in preview = new } }
        }
        Group {
            switch mode {
            case .showcase: DesignShowcase()
            case .tokens: DesignTokenList(tokens: DesignCatalog.tokens(for: preview.theme))
            }
        }
        .themed(preview.theme.palette)
        .modifier(PreviewFrame(palette: preview.theme.palette))
        .id(preview)
    }

    private var footer: String {
        let using = model.settings.theme
        if using == preview.theme { return "This is the theme ATOM uses now." }
        return "A preview: ATOM still uses \(using.title). Choose a theme in Appearance."
    }
}

/// The preview's ground: the previewed theme's window colour, inside the app's own hairline.
private struct PreviewFrame: ViewModifier {
    let palette: ThemePalette
    @Environment(\.theme) private var appTheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: appTheme.radiusCard, style: .continuous)
        content
            .padding(Spacing.well)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(palette.surfaceSolid.color))
            .overlay(shape.strokeBorder(appTheme.hairline(), lineWidth: 1))
            .clipShape(shape)
    }
}

// MARK: - Showcase

/// The shared components, each in the states it can show.
private struct DesignShowcase: View {
    @Environment(\.theme) private var theme
    @State private var switchOn = true
    @State private var choice: DesignShowcaseMode = .showcase
    @State private var menuChoice: AppTheme = .void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.wells) {
            Card("Component previews") {
                Text("Examples of ATOM’s interface. Loading, empty and error states below are demonstrations, not the app’s current status.")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                    .fixedSize(horizontal: false, vertical: true).padding(Spacing.well)
            }
            ShowcaseGroup("Type") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(DesignCatalog.typeScale, id: \.name) { step in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(step.size >= 26 ? "1,284" : step.role)
                                .font(.system(size: step.size, weight: step.size >= 15 ? .semibold : .regular).monospacedDigit())
                                .foregroundStyle(step.size <= 11 ? theme.text3.color : step.size == 12 ? theme.text2.color : theme.text.color)
                                .lineLimit(1)
                            Spacer(minLength: 6)
                            Text(step.size >= 26 ? "Number · 26 pt" : "\(Int(step.size)) pt").font(theme.idFont(.caption2, size: 11)).foregroundStyle(theme.idColor(theme.text3))
                        }
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("claude-opus").font(theme.idFont(.system(size: 12, design: .monospaced), size: 12)).foregroundStyle(theme.idColor(theme.accent))
                        Text("1.4 s").font(theme.idFont(.system(size: 12, design: .monospaced), size: 12)).foregroundStyle(theme.text2.color)
                        Text("— identifiers and readouts are SF Mono").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                    }
                }
            }

            ShowcaseGroup("Buttons") {
                FlowLayout(spacing: 8) {
                    PillButton(title: "Allow", prominent: true) {}
                    PillButton(title: "Not now") {}
                    PillButton(title: "New chat", symbol: "plus") {}
                    PillButton(title: "Unavailable") {}.disabled(true).opacity(0.45)
                    IconButton(symbol: "arrow.clockwise", label: "Try again", diameter: ControlMetrics.buttonHeight) {}
                    IconButton(symbol: "xmark", label: "Close", diameter: ControlMetrics.buttonHeight) {}
                }
                caption(theme.isGhost
                        ? "Void never fills a button, the main action included: every button is a hairline (ADR-086). Disabled sits at 45 percent."
                        : "The filled button is the one main action in a view. Disabled sits at 45 percent.")
            }

            ShowcaseGroup("Controls") {
                Card {
                    Row(title: "Switch", detail: switchOn ? "On" : "Off") {
                        ThemedSwitch(isOn: switchOn, set: { switchOn = $0 }, label: "Switch")
                    }
                    RowDivider()
                    Row(title: "Segmented") { Segmented(selection: choice) { choice = $0 } }
                    RowDivider()
                    ChoiceRow(title: "Menu", detail: "Five or more choices become a pop-up", selection: menuChoice) { menuChoice = $0 }
                }
            }

            ShowcaseGroup("Status") {
                Card {
                    statusRow("Listening", .listening)
                    RowDivider()
                    statusRow("Thinking", .thinking)
                    RowDivider()
                    statusRow("Needs you", .asking)
                    RowDivider()
                    statusRow("Problem", .problem)
                    RowDivider()
                    statusRow("Ready", .ready)
                }
                caption("A status is a word with a dot, never colour alone.")
            }

            ShowcaseGroup("State previews") {
                caption("Static examples — nothing is loading here. Sample actions are disabled.")
                stateWell("Empty example") {
                    EmptyStateView(title: "No chats yet",
                                   detail: "Your conversations with ATOM appear here.",
                                   action: (title: "New chat", symbol: "plus", run: {})).disabled(true)
                }
                stateWell("Loading example") {
                    LoadingStateView(text: "Loading models — example", automaticallyShowsSlow: false)
                }
                stateWell("Slow response example") {
                    LoadingStateView(text: "Loading models — example", retry: {}, slow: true, automaticallyShowsSlow: false)
                        .disabled(true)
                }
                stateWell("Long text", inset: false) {
                    Row(title: "Read the screen before answering, including windows that belong to other apps and other Spaces",
                        detail: "A long title and a full-sentence detail wrap onto more lines; they are never cut short.") {
                        ThemedSwitch(isOn: false, set: { _ in }, label: "Long row")
                    }
                }
            }
        }
    }

    private func statusRow(_ word: String, _ kind: IslandStatus.Kind) -> some View {
        HStack(spacing: 8) {
            StatusDot(color: theme.tint(kind))
            Text(word).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.well)
        .frame(minHeight: 34)
        .accessibilityElement(children: .combine)
    }

    /// A state example in a padded well, labelled with the state it shows.
    /// `inset: false` for content that pads itself, such as a `Row`.
    private func stateWell(_ label: String, inset: Bool = true, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(theme.idFont(.caption2, size: 11)).foregroundStyle(theme.text3.color)
                .padding(.horizontal, inset ? 0 : Spacing.well)
            content()
        }
        .padding(.horizontal, inset ? Spacing.well : 0)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardWell(theme)
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.system(size: 11)).foregroundStyle(theme.text3.color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A titled group in the preview.
private struct ShowcaseGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.theme) private var theme

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold)).tracking(0.6)
                .foregroundStyle(theme.text3.color)
                .accessibilityAddTraits(.isHeader)
            content
        }
    }
}

// MARK: - Tokens

/// Every token, grouped as tokens.css groups them. Clicking a row copies its `var(--name)`.
private struct DesignTokenList: View {
    let tokens: [DesignToken]
    @Environment(\.theme) private var theme
    @State private var copied: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.wells) {
            ForEach(DesignToken.Group.allCases, id: \.self) { group in
                let rows = tokens.filter { $0.group == group }
                if !rows.isEmpty {
                    ShowcaseGroup(group.rawValue) {
                        Card {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { index, token in
                                if index > 0 { RowDivider(inset: Spacing.well + 42) }
                                TokenRow(token: token, copied: copied == token.name) { copy(token) }
                            }
                        }
                    }
                }
            }
            Text("Click a token to copy its CSS variable. The same values live in design/atom-design-system/tokens.css.")
                .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func copy(_ token: DesignToken) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(token.cssVariable, forType: .string)
        copied = token.name
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            if copied == token.name { copied = nil }
        }
    }
}

private struct TokenRow: View {
    let token: DesignToken
    let copied: Bool
    let copy: () -> Void
    @Environment(\.theme) private var theme
    @State private var hovering = false

    var body: some View {
        Button(action: copy) {
            HStack(alignment: .top, spacing: 10) {
                TokenSample(token: token).frame(width: 32, alignment: .leading).frame(minHeight: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(token.name)
                        .font(theme.idFont(.system(size: 12, design: .monospaced), size: 12))
                        .foregroundStyle(theme.text.color)
                    Text(token.role)
                        .font(.system(size: 11)).foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true)
                    // A Swift name in mono; a description of where it lives in plain type.
                    Text(token.source)
                        .font(token.source.contains(" ") ? .system(size: 11) : theme.idFont(.system(size: 11, design: .monospaced), size: 11))
                        .foregroundStyle(theme.text3.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(copied ? "Copied" : token.display)
                        .font(theme.idFont(.system(size: 11, design: .monospaced), size: 11))
                        .foregroundStyle(copied ? theme.success.color : theme.text2.color)
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 220, alignment: .trailing)
                    if let contrast = token.contrast {
                        Text(String(format: "%.1f:1", contrast))
                            .font(theme.idFont(.system(size: 11, design: .monospaced), size: 11))
                            .foregroundStyle(contrast >= 4.5 ? theme.text3.color : theme.problem.color)
                    }
                }
            }
            .padding(.horizontal, Spacing.well)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovering ? theme.fill1.color : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Copy \(token.cssVariable)")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(token.name), \(token.display), \(token.role)")
        .accessibilityValue(token.contrast.map { String(format: "contrast %.1f to 1", $0) } ?? "")
        .accessibilityHint("Copies \(token.cssVariable)")
    }
}

/// A small picture of the token's value: a swatch, a bar, a corner, a letter.
private struct TokenSample: View {
    let token: DesignToken
    @Environment(\.theme) private var theme

    var body: some View {
        switch token.value {
        case .color(let c):
            RoundedRectangle(cornerRadius: 5, style: .continuous).fill(c.color)
                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.hairline(), lineWidth: 1))
                .frame(width: 20, height: 20)
        case .points(let p) where token.group == .radius:
            RoundedRectangle(cornerRadius: min(p, 10), style: .continuous)
                .strokeBorder(theme.text2.color, lineWidth: 1.5)
                .frame(width: 20, height: 20)
        case .points(let p) where token.group == .spacing:
            // A ruler: bars share a left edge, 32 pt fills the column.
            Rectangle().fill(theme.text2.color).frame(width: max(2, p * 24 / 32), height: 4).frame(height: 16)
        case .points(let p):
            Text(p >= 26 ? "42" : "Aa").font(.system(size: p, weight: .medium).monospacedDigit()).foregroundStyle(theme.text.color)
                .lineLimit(1).fixedSize()
        case .duration(let ms):
            // A bar as long as the time: 200 ms fills the column.
            Capsule().fill(theme.text2.color).frame(width: CGFloat(ms) * 24 / 200, height: 4).frame(height: 16)
        case .text where token.name == "--font-mono":
            Text("{}").font(.system(size: 12, design: .monospaced)).foregroundStyle(theme.text.color)
        case .text where token.group == .type:
            Text("Aa").font(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
        case .text where token.name == "--focus-ring":
            RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.text.color, lineWidth: 2).frame(width: 20, height: 20)
        case .text where token.name == "--elev-ring":
            RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.hairline(), lineWidth: 1).frame(width: 20, height: 20)
        case .text where token.group == .motion:
            EaseCurve().stroke(theme.text2.color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round)).frame(width: 18, height: 16)
        case .text:
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(theme.text3.color, style: StrokeStyle(lineWidth: 1, dash: [2, 2])).frame(width: 20, height: 20)
        }
    }
}

/// cubic-bezier(0.2, 0, 0, 1), drawn in its own box.
private struct EaseCurve: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * rect.width, y: rect.maxY - y * rect.height) }
        path.move(to: point(0, 0))
        path.addCurve(to: point(1, 1), control1: point(0.2, 0), control2: point(0, 1))
        return path
    }
}
