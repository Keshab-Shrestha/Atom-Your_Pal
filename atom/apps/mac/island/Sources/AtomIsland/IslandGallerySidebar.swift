import AppKit
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// ADR-128: the window with the sidebar hidden: the main pane fills it and the show-sidebar button sits at the top bar's left.
    static func writeSidebarHidden(to directory: URL, theme: AppTheme = .void, name: String = "23-sidebar-hidden") {
        let suite = "atom.gallery.sidebar.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        m.settings.sidebarHidden = true
        m.windowPage = .dashboard // not Chat: a snapshot draws its text field as a yellow placeholder
        let palette = theme.palette
        let shape = RoundedRectangle(cornerRadius: palette.isFlat ? 24 : 16, style: .continuous)
        let page = frozen(HelpersView(model: m).environment(\.islandSnapshot, true).frame(width: 720, height: 520))
            .overlay(alignment: .topLeading) { // the window's own buttons, which only the window server draws
                HStack(spacing: 8) {
                    ForEach([0xFF5F57, 0xFEBC2E, 0x28C840] as [UInt32], id: \.self) { hex in Circle().fill(RGBA(hex: hex).color).frame(width: 12, height: 12) }
                }
                .padding(.leading, 16).padding(.top, 16)
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(palette.isFlat ? palette.border.color : Color.white.opacity(0.1), lineWidth: palette.isFlat ? 1 : 0.5))
            .padding(24)
            .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(page, name: name, to: directory)
    }
}
