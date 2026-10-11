import AppKit
import SwiftUI
import ZenoIslandCore

/// The island window: borderless, on every Space and over full-screen apps. Compact, it never takes
/// keyboard focus. Expanded, it can become key after a click (for the shortcut recorder) without
/// activating ZENO, so the app you were using stays active (ADR-040).
/// It is positioned by `IslandController`; it does not move itself.
final class IslandPanel: NSPanel {
    /// Set by the controller while expanded.
    var acceptsKeyFocus = false
    /// Called for Esc while the panel is key.
    var onCancel: () -> Void = {}

    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isFloatingPanel = true // must come before `level`: setting it resets the level to .floating
        // Above ordinary windows and full-screen apps, and above the menu bar's level so its shadow is not clipped.
        level = IslandPanel.islandLevel
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovable = false
        isReleasedWhenClosed = false
        animationBehavior = .none
        setAccessibilityRole(.popover)
        setAccessibilityLabel("ZENO")
    }

    static let islandLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 2)

    override var canBecomeKey: Bool { acceptsKeyFocus }
    override var canBecomeMain: Bool { false }

    /// The hidden position is past the left edge of the display; do not let AppKit pull it back on screen.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    override func cancelOperation(_ sender: Any?) { onCancel() }
}

/// The island's content on dark glass: the compact card, or the expanded view after a click (ADR-038).
struct IslandView: View {
    let model: IslandModel
    /// For development snapshots (`ZENO_ISLAND_SNAPSHOTS`): a plain dark fill instead of the glass,
    /// which only the window server can draw.
    var snapshot = false
    static let cornerRadius: CGFloat = 16
    static let expandedCornerRadius: CGFloat = 22
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let palette = model.settings.theme.palette
        let radius = model.showsExpanded ? palette.radiusSurface : IslandView.cornerRadius
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack(alignment: .topLeading) {
            if model.showsExpanded {
                ExpandedView(model: model)
                    .transition(.opacity)
            } else {
                CompactView(model: model)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            SurfaceBackground(shape: shape, glass: !snapshot, systemGlassRadius: radius)
        }
        .clipShape(shape)
        // ADR-084: grows from the menu-bar icon as it opens (the window drops and fades in alongside), shrinks a
        // little as it leaves. With Reduce Motion it only fades (the window's alpha).
        .scaleEffect(model.presented || reduceMotion ? 1 : (model.expanded ? 0.96 : 0.98), anchor: UnitPoint(x: model.openAnchorX, y: 0))
        .themed(palette)
        .environment(\.islandSnapshot, snapshot)
        .animation(.easeOut(duration: 0.16), value: model.showsExpanded)
    }
}

/// The compact card (ADR-038): ZENO's state, a short detail line and, while listening, a live waveform.
/// Clicking it opens the expanded view.
struct CompactView: View {
    let model: IslandModel
    /// `State` without the `@State` macro: Command Line Tools ship no SwiftUI macro plugin.
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme

    var body: some View {
        StatusRow(model: model)
        .padding(.leading, 11)
        .padding(.trailing, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.fill1.color.opacity(hovering.wrappedValue ? 1 : 0))
        .contentShape(Rectangle())
        .onHover { hovering.wrappedValue = $0 }
        .onTapGesture { model.setExpanded(true) }
        .animation(.easeOut(duration: 0.18), value: model.status.showsLevel)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.status.detail.isEmpty ? "ZENO: \(model.status.title)" : "ZENO: \(model.status.title). \(model.status.detail)")
        .accessibilityHint("Opens the conversation, status and settings")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.setExpanded(true) }
    }
}

/// The state glyph, title, detail (or the words heard so far while dictating) and level meter.
/// Shared by the compact card and Pal's speech bubble.
struct StatusRow: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 11) {
            StateGlyph(kind: model.status.kind)
                .frame(width: theme.statusDots ? 8 : 30, height: 30)

            VStack(alignment: .leading, spacing: 1) {
                Text(model.pointing.target.map(PointingState.line(for:)) ?? model.status.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.text.color)
                if model.pointing.target != nil {
                    Text("ZENO is pointing")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.text2.color)
                } else if !model.status.preview.isEmpty {
                    Text(model.status.preview)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.text.color.opacity(0.88))
                        .truncationMode(.head)
                } else if !model.status.detail.isEmpty {
                    Text(model.status.detail)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.text2.color)
                }
            }
            .lineLimit(1)
            .contentTransition(.opacity)
            .animation(.easeOut(duration: 0.18), value: model.status.title)

            Spacer(minLength: 4)

            if model.status.showsLevel {
                Waveform(levels: model.meter.history, color: theme.live.color)
                    .frame(width: 46, height: 22)
                    .transition(.opacity)
            } else if let busy = model.helpers.list?.helpers.filter({ $0.jobs.contains { $0.state == .running } }), !busy.isEmpty {
                // Task 3.15: the workers at work, each with its working arc.
                HStack(spacing: 6) {
                    ForEach(busy.prefix(3)) { helper in HelperBadge(helper: helper, size: 20).help("\(helper.name): \(helper.activity)") }
                }
                .transition(.opacity)
                .accessibilityLabel("Working: \(busy.map(\.name).joined(separator: ", "))")
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.status.showsLevel)
    }
}

/// A round badge whose icon and colour follow ZENO's state.
struct StateGlyph: View {
    let kind: IslandStatus.Kind
    @Environment(\.theme) private var theme

    var body: some View {
        let tint = theme.tint(kind)
        if theme.statusDots {
            // Void (ADR-086): the state is a small dot of its status colour; the title beside it says the rest.
            StatusDot(color: tint).animation(.easeOut(duration: 0.15), value: kind)
        } else {
            badge(tint)
        }
    }

    private func badge(_ tint: Color) -> some View {
        ZStack {
            Circle().fill(tint.opacity(theme.isDark ? 0.2 : 0.14))
            Image(systemName: StateGlyph.symbol(kind))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.pulse, options: .repeating, isActive: kind == .thinking || kind == .transcribing || kind == .starting || kind == .acting)
        }
        .animation(.easeOut(duration: 0.2), value: kind)
    }

    static func symbol(_ kind: IslandStatus.Kind) -> String {
        switch kind {
        case .starting: "hourglass"
        case .ready: "waveform"
        case .listening: "mic.fill"
        case .transcribing: "text.bubble"
        case .thinking: "sparkles"
        case .speaking: "speaker.wave.2.fill"
        case .notice: "hand.raised.fill"
        case .problem: "exclamationmark.triangle.fill"
        case .acting: "cursorarrow.motionlines"
        case .asking: "hand.raised.fill"
        }
    }
}

/// Bars for the recent microphone levels, newest on the right.
struct Waveform: View {
    let levels: [Double]
    var color: Color = .white

    var body: some View {
        GeometryReader { proxy in
            let count = max(1, levels.count)
            let gap: CGFloat = 2
            let width = max(1, (proxy.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: gap) {
                ForEach(levels.indices, id: \.self) { i in
                    Capsule()
                        .fill(color.opacity(0.5 + 0.5 * levels[i]))
                        .frame(width: width, height: max(width, proxy.size.height * levels[i]))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.linear(duration: 0.05), value: levels)
        }
        .accessibilityHidden(true)
    }
}

/// The system glass behind a surface: Liquid Glass on macOS 26 and later, a blur before that. Tinted and set
/// light or dark by the theme (ADR-057).
struct GlassBackground: NSViewRepresentable {
    let cornerRadius: CGFloat
    var tint: NSColor = NSColor(white: 0.04, alpha: 0.55)
    var dark = true

    func makeNSView(context: Context) -> NSView {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            configure(glass)
            return glass
        }
        let blur = NSVisualEffectView()
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.wantsLayer = true
        blur.layer?.cornerCurve = .continuous
        blur.layer?.masksToBounds = true
        configure(blur)
        return blur
    }

    func updateNSView(_ view: NSView, context: Context) { configure(view) }

    private func configure(_ view: NSView) {
        view.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        if #available(macOS 26.0, *), let glass = view as? NSGlassEffectView {
            glass.cornerRadius = cornerRadius
            glass.style = .regular
            glass.tintColor = tint
        } else if let blur = view as? NSVisualEffectView {
            blur.material = dark ? .hudWindow : .popover
            blur.layer?.cornerRadius = cornerRadius
            // A behind-window blur is cut by the window server, which ignores the layer's corner radius: without a
            // mask image its corners come out square.
            blur.maskImage = Self.roundedMask(cornerRadius)
        }
    }

    /// A stretchable rounded-rectangle mask with continuous-looking corners for `NSVisualEffectView.maskImage`.
    static func roundedMask(_ radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            // The same continuous curve SwiftUI draws the panel with, so the blur and the panel's edge match.
            let path = RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect).cgPath
            NSGraphicsContext.current?.cgContext.addPath(path)
            NSGraphicsContext.current?.cgContext.setFillColor(NSColor.black.cgColor)
            NSGraphicsContext.current?.cgContext.fillPath()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }
}
