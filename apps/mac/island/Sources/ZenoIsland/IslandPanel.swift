import AppKit
import SwiftUI
import ZenoIslandCore

/// The island window: borderless, never takes keyboard focus, on every Space and over full-screen apps.
/// It is positioned by `IslandController`; it does not move itself.
final class IslandPanel: NSPanel {
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

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    /// The hidden position is past the left edge of the display; do not let AppKit pull it back on screen.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// What the island shows. Observed by `IslandView`.
@MainActor @Observable
final class IslandModel {
    var status = IslandStatus()
    var meter = LevelMeter(bars: 14)
}

/// The compact island (ADR-038): dark glass card with ZENO's state, a short detail line and, while
/// listening, a live waveform from the microphone level.
struct IslandView: View {
    let model: IslandModel
    /// For development snapshots (`ZENO_ISLAND_SNAPSHOTS`): a plain dark fill instead of the glass,
    /// which only the window server can draw.
    var snapshot = false
    static let cornerRadius: CGFloat = 16

    var body: some View {
        HStack(spacing: 11) {
            StateGlyph(kind: model.status.kind)
                .frame(width: 30, height: 30)

            VStack(alignment: .leading, spacing: 1) {
                Text(model.status.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                if !model.status.detail.isEmpty {
                    Text(model.status.detail)
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.62))
                }
            }
            .lineLimit(1)
            .contentTransition(.opacity)
            .animation(.easeOut(duration: 0.18), value: model.status.title)

            Spacer(minLength: 4)

            if model.status.showsLevel {
                Waveform(levels: model.meter.history)
                    .frame(width: 46, height: 22)
                    .transition(.opacity)
            }
        }
        .padding(.leading, 11)
        .padding(.trailing, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .animation(.easeOut(duration: 0.18), value: model.status.showsLevel)
        .background {
            if snapshot {
                RoundedRectangle(cornerRadius: IslandView.cornerRadius, style: .continuous).fill(Color(white: 0.11).opacity(0.9))
            } else {
                GlassBackground(cornerRadius: IslandView.cornerRadius)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: IslandView.cornerRadius, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 0.5)
        )
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.status.detail.isEmpty ? "ZENO: \(model.status.title)" : "ZENO: \(model.status.title). \(model.status.detail)")
    }
}

/// A round badge whose icon and colour follow ZENO's state.
struct StateGlyph: View {
    let kind: IslandStatus.Kind

    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(0.22))
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.pulse, options: .repeating, isActive: kind == .thinking || kind == .transcribing || kind == .starting)
        }
        .animation(.easeOut(duration: 0.2), value: kind)
    }

    private var symbol: String {
        switch kind {
        case .starting: "hourglass"
        case .ready: "waveform"
        case .listening: "mic.fill"
        case .transcribing: "text.bubble"
        case .thinking: "sparkles"
        case .speaking: "speaker.wave.2.fill"
        case .notice: "hand.raised.fill"
        case .problem: "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch kind {
        case .starting: Color(white: 0.75)
        case .ready: Color(red: 0.38, green: 0.86, blue: 0.52)
        case .listening: Color(red: 1.0, green: 0.36, blue: 0.36)
        case .transcribing, .thinking: Color(red: 0.62, green: 0.56, blue: 1.0)
        case .speaking: Color(red: 0.36, green: 0.70, blue: 1.0)
        case .notice: Color(red: 1.0, green: 0.80, blue: 0.35)
        case .problem: Color(red: 1.0, green: 0.58, blue: 0.28)
        }
    }
}

/// Bars for the recent microphone levels, newest on the right.
struct Waveform: View {
    let levels: [Double]

    var body: some View {
        GeometryReader { proxy in
            let count = max(1, levels.count)
            let gap: CGFloat = 2
            let width = max(1, (proxy.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: gap) {
                ForEach(levels.indices, id: \.self) { i in
                    Capsule()
                        .fill(.white.opacity(0.55 + 0.45 * levels[i]))
                        .frame(width: width, height: max(width, proxy.size.height * levels[i]))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.linear(duration: 0.05), value: levels)
        }
        .accessibilityHidden(true)
    }
}

/// Dark glass: the system glass material on macOS 26 and later, a dark blur before that.
struct GlassBackground: NSViewRepresentable {
    let cornerRadius: CGFloat

    func makeNSView(context: Context) -> NSView {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = cornerRadius
            glass.style = .regular
            glass.tintColor = NSColor(white: 0.04, alpha: 0.55) // dark, still showing what is behind
            return glass
        }
        let blur = NSVisualEffectView()
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.appearance = NSAppearance(named: .vibrantDark)
        blur.wantsLayer = true
        blur.layer?.cornerRadius = cornerRadius
        blur.layer?.cornerCurve = .continuous
        blur.layer?.masksToBounds = true
        return blur
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
