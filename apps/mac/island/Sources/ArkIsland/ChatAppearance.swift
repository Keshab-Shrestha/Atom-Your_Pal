import AppKit
import SwiftUI
import ArkIslandCore

/// Native adaptation of T3 Code's desktop tokens/layout at 1451e7cb (MIT, T3 Tools Inc.).
/// Pinned sources and license: reference/t3code-visual-design.md, reference/licenses/t3code-MIT.txt.
enum ChatAppearance {
    // T3's 46rem reading column plus 24pt gutters on each side.
    static let column: CGFloat = 784
    /// The messages and the composer: T3's 46rem column (2026-11-01; it was 880, wider than a comfortable line).
    static let readingWidth: CGFloat = 736

    /// Keep the desktop layout while honoring every color in the user's chosen theme.
    static func palette(theme: AppTheme, sidebar: Bool = false) -> ThemePalette {
        var p = theme.palette
        if sidebar { p.surfaceSolid = WorkspaceColors.for(theme).panel }
        p.surface = p.surfaceSolid
        p.surfaceTop = nil
        return p
    }

    /// The window's palette in the material that is shown (ADR-255). Flat: as `palette(theme:sidebar:)`. Glass: the glass palette;
    /// `surfaceSolid` stays the opaque pane colour for masks, and `surface` stays the frosted tint for floating surfaces.
    @MainActor static func palette(settings: IslandSettings, sidebar: Bool = false) -> ThemePalette {
        guard settings.glassShown else { return palette(theme: settings.theme, sidebar: sidebar) }
        var p = settings.palette
        let lanes = settings.lanes
        if sidebar { p.surfaceSolid = lanes.panel.over(lanes.frame) }
        p.surfaceTop = nil
        return p
    }

    static func palette(dark: Bool, sidebar: Bool = false) -> ThemePalette {
        var p = dark ? ThemePalette.void : .daylight
        p.surfaceSolid = RGBA(hex: dark ? (sidebar ? 0x000000 : 0x0A0A0A) : (sidebar ? 0xFAFAFA : 0xFCFCFC))
        p.surface = p.surfaceSolid
        p.surfaceTop = nil
        p.text = RGBA(hex: dark ? 0xF5F5F5 : 0x27272A)
        p.text2 = RGBA(hex: dark ? 0xD4D4D4 : 0x52525B)
        p.text3 = RGBA(hex: dark ? 0xA3A3A3 : 0x71717A)
        p.fill1 = RGBA(hex: dark ? 0x171717 : 0xF4F4F5)
        p.fill2 = RGBA(hex: dark ? 0x202020 : 0xEDEDEF)
        p.fill3 = RGBA(hex: dark ? 0x292929 : 0xE4E4E7)
        p.border = RGBA(hex: dark ? 0x242424 : 0xE4E4E7)
        p.separator = p.border
        p.rim = p.border
        p.borderHover = RGBA(hex: dark ? 0x404040 : 0xA1A1AA)
        p.accent = RGBA(hex: dark ? 0x3B82F6 : 0x2563EB)
        p.accentEnd = p.accent
        p.onAccent = .white(1)
        p.buttonStyle = .filled
        p.radiusSurface = 24; p.radiusCard = 16; p.radiusControl = 8
        p.monoIdentifiers = false; p.identifier = nil
        p.cornerGap = 16
        return p
    }
}

/// Also update AppKit controls and window chrome when the theme changes while the window is open.
struct DesktopWindowAppearance: NSViewRepresentable {
    let palette: ThemePalette
    /// ADR-277: the window shows the desktop behind it (`IslandSettings.translucentShown`).
    var translucent = false

    /// Full screen has no desktop behind the window, so the window is opaque there; these re-apply the look on entering and leaving.
    final class Coordinator {
        var tokens: [NSObjectProtocol] = []
        deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSView { NSView() }
    func updateNSView(_ view: NSView, context: Context) {
        let palette = palette, translucent = translucent
        DispatchQueue.main.async { [weak view, weak coordinator = context.coordinator] in
            guard let window = view?.window else { return }
            Self.apply(to: window, palette: palette, translucent: translucent)
            guard let coordinator, coordinator.tokens.isEmpty else { return }
            coordinator.tokens = [NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification].map { name in
                NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak window] _ in
                    guard let window else { return }
                    Self.apply(to: window, palette: palette, translucent: translucent)
                }
            }
        }
    }

    /// Opaque: the pane colour fills the window. Translucent: the window is clear, so the blur in `TranslucentBackdrop` shows the
    /// desktop; it keeps its shadow, which AppKit then takes from the content, so it is drawn again after a change.
    static func apply(to window: NSWindow, palette: ThemePalette, translucent wanted: Bool) {
        let translucent = wanted && !window.styleMask.contains(.fullScreen)
        window.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
        let changed = window.isOpaque == translucent
        window.isOpaque = !translucent
        window.backgroundColor = translucent ? .clear : palette.surfaceSolid.nsColor
        window.hasShadow = translucent || palette.usesShadows
        if changed { window.invalidateShadow() }
    }
}

/// ADR-277: the system's blur of what is behind the window, under the tint and the panes. A snapshot cannot draw it (the
/// gallery draws a blurred wallpaper instead), so it is left out there.
struct TranslucentBackdrop: View {
    let theme: AppTheme
    let strength: TranslucencyStrength
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        ZStack {
            if !snapshot { BehindWindowBlur(material: WindowTranslucency.material(dark: theme.palette.isDark)) }
            WindowTranslucency.tint(theme, strength: strength).color
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The blur never takes a click: the drag area and the controls above it (and double-click to zoom) keep working.
private final class ClickThroughEffectView: NSVisualEffectView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private struct BehindWindowBlur: NSViewRepresentable {
    let material: WindowTranslucency.Material

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = ClickThroughEffectView()
        view.blendingMode = .behindWindow
        view.state = .active // blur also while ARK is not the active app, as the reference does
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = switch material {
        case .hudWindow: .hudWindow
        case .sidebar: .sidebar
        }
    }
}

private struct DesktopDesignKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var desktopDesign: Bool {
        get { self[DesktopDesignKey.self] }
        set { self[DesktopDesignKey.self] = newValue }
    }
}

/// Natural-width short bubbles, capped at T3's 80% for long prompts, without a GeometryReader row height.
struct ChatUserBubbleLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? ChatAppearance.column
        let size = subviews[0].sizeThatFits(ProposedViewSize(width: width * 0.8, height: nil))
        return CGSize(width: width, height: size.height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let size = subviews[0].sizeThatFits(ProposedViewSize(width: bounds.width * 0.8, height: nil))
        subviews[0].place(at: CGPoint(x: bounds.maxX, y: bounds.minY), anchor: .topTrailing,
                          proposal: ProposedViewSize(width: min(size.width, bounds.width * 0.8), height: size.height))
    }
}
