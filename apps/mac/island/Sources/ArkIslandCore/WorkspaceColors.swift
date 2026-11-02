import Foundation

/// Semantic colours transcribed from the user-supplied four-lane workspace. No HTML/scripts or fonts execute.
public struct WorkspaceColors: Sendable {
    public var frame, rail, panel, work, workspace, card, bubble: RGBA
    public var palette: ThemePalette

    /// Light workspace themes deliberately keep a dark navigation rail.
    public var navigationPalette: ThemePalette {
        var p = palette
        if RGBA.contrast(p.text, rail) < 4.5 {
            p.text = .white(1); p.text2 = .white(0.78); p.text3 = .white(0.6)
            p.accent = .white(0.6).over(p.accent); p.accentEnd = p.accent
            p.separator = .white(0.1)
        }
        return p
    }

    /// 2026-11-01 redesign: lanes and palette from one builder, the same tone steps for every theme (ThemeTones.swift).
    public static func `for`(_ theme: AppTheme) -> WorkspaceColors { ThemeBuilder.lanes(theme) }
}
