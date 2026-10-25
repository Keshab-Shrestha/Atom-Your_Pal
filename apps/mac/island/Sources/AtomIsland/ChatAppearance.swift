import AppKit
import SwiftUI
import AtomIslandCore

/// Native adaptation of T3 Code's desktop tokens/layout at 1451e7cb (MIT, T3 Tools Inc.).
/// Pinned sources and license: reference/t3code-visual-design.md, reference/licenses/t3code-MIT.txt.
enum ChatAppearance {
    // T3's 46rem reading column plus 24pt gutters on each side.
    static let column: CGFloat = 784

    /// Keep the desktop layout while honoring every color in the user's chosen theme.
    static func palette(theme: AppTheme, sidebar: Bool = false) -> ThemePalette {
        var p = theme.palette
        if sidebar { p.surfaceSolid = WorkspaceColors.for(theme).panel }
        p.surface = p.surfaceSolid
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
    func makeNSView(context: Context) -> NSView { NSView() }
    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async { [weak view] in
            guard let window = view?.window else { return }
            window.appearance = NSAppearance(named: palette.isDark ? .darkAqua : .aqua)
            window.backgroundColor = palette.surfaceSolid.nsColor
            window.hasShadow = palette.usesShadows
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
