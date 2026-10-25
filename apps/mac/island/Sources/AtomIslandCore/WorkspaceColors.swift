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

    public static func `for`(_ theme: AppTheme) -> WorkspaceColors {
        switch theme {
        case .sapphire:
            var p = ThemePalette.void
            p.text = RGBA(hex: 0xF5F7FF)
            p.text2 = RGBA(hex: 0xC8CCD6)
            p.text3 = RGBA(hex: 0xA0A5B0)
            p.fill1 = RGBA(hex: 0x101727)
            p.fill2 = RGBA(hex: 0x151E30)
            p.fill3 = RGBA(hex: 0x090E19)
            p.border = RGBA(0.960784, 0.968627, 1.0, 0.14)
            p.separator = RGBA(0.960784, 0.968627, 1.0, 0.08)
            p.rim = RGBA(0.960784, 0.968627, 1.0, 0.08)
            p.borderHover = RGBA(0.960784, 0.968627, 1.0, 0.26)
            p.accent = RGBA(hex: 0x6D8DFF)
            p.onAccent = RGBA(hex: 0x0B1220)
            p.attention = RGBA(hex: 0xEBC683)
            p.problem = RGBA(hex: 0xF2A190)
            p.success = RGBA(hex: 0x74D6AE)
            p.live = RGBA(hex: 0x74D6AE)
            p.surfaceSolid = RGBA(hex: 0x0B1220); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0x070B13), rail: RGBA(hex: 0x090F1A), panel: RGBA(hex: 0x101929), work: RGBA(hex: 0x0B1220), workspace: RGBA(hex: 0x0E1626), card: RGBA(hex: 0x151E30), bubble: RGBA(hex: 0x2F3F6E), palette: p)
        case .champagne:
            var p = ThemePalette.void
            p.text = RGBA(hex: 0xF5F0E7)
            p.text2 = RGBA(hex: 0xCAC6C0)
            p.text3 = RGBA(hex: 0xA3A19D)
            p.fill1 = RGBA(hex: 0x16181C)
            p.fill2 = RGBA(hex: 0x1D2025)
            p.fill3 = RGBA(hex: 0x0C0D10)
            p.border = RGBA(0.960784, 0.941176, 0.905882, 0.14)
            p.separator = RGBA(0.960784, 0.941176, 0.905882, 0.08)
            p.rim = RGBA(0.960784, 0.941176, 0.905882, 0.08)
            p.borderHover = RGBA(0.960784, 0.941176, 0.905882, 0.26)
            p.accent = RGBA(hex: 0xC9A96E)
            p.onAccent = RGBA(hex: 0x101114)
            p.attention = RGBA(hex: 0xEBC683)
            p.problem = RGBA(hex: 0xF2A190)
            p.success = RGBA(hex: 0x74D6AE)
            p.live = RGBA(hex: 0x74D6AE)
            p.surfaceSolid = RGBA(hex: 0x101114); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0x0A0A0C), rail: RGBA(hex: 0x0D0E10), panel: RGBA(hex: 0x17191D), work: RGBA(hex: 0x101114), workspace: RGBA(hex: 0x15161A), card: RGBA(hex: 0x1D2025), bubble: RGBA(hex: 0x51493B), palette: p)
        case .emerald:
            var p = ThemePalette.daylight
            p.text = RGBA(hex: 0x182321)
            p.text2 = RGBA(hex: 0x49514E)
            p.text3 = RGBA(hex: 0x626865)
            p.fill1 = RGBA(hex: 0xF7F5EF)
            p.fill2 = RGBA(hex: 0xFFFFFF)
            p.fill3 = RGBA(hex: 0xE7E6E1)
            p.border = RGBA(0.094118, 0.137255, 0.129412, 0.14)
            p.separator = RGBA(0.094118, 0.137255, 0.129412, 0.08)
            p.rim = RGBA(0.094118, 0.137255, 0.129412, 0.08)
            p.borderHover = RGBA(0.094118, 0.137255, 0.129412, 0.26)
            p.accent = RGBA(hex: 0x176B5B)
            p.onAccent = RGBA(hex: 0xFFFFFF)
            p.attention = RGBA(hex: 0x8A5A12)
            p.problem = RGBA(hex: 0x7A2614)
            p.success = RGBA(hex: 0x0E5E3F)
            p.live = RGBA(hex: 0x13805A)
            p.surfaceSolid = RGBA(hex: 0xF7F5EF); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0xE1E0DA), rail: RGBA(hex: 0x182321), panel: RGBA(hex: 0xFFFFFF), work: RGBA(hex: 0xF7F5EF), workspace: RGBA(hex: 0xEDECE6), card: RGBA(hex: 0xFFFFFF), bubble: RGBA(hex: 0x182321), palette: p)
        case .plum:
            var p = ThemePalette.void
            p.text = RGBA(hex: 0xF7F0FA)
            p.text2 = RGBA(hex: 0xCDC5D2)
            p.text3 = RGBA(hex: 0xA89FAE)
            p.fill1 = RGBA(hex: 0x1E1627)
            p.fill2 = RGBA(hex: 0x261B31)
            p.fill3 = RGBA(hex: 0x120D18)
            p.border = RGBA(0.968627, 0.941176, 0.980392, 0.14)
            p.separator = RGBA(0.968627, 0.941176, 0.980392, 0.08)
            p.rim = RGBA(0.968627, 0.941176, 0.980392, 0.08)
            p.borderHover = RGBA(0.968627, 0.941176, 0.980392, 0.26)
            p.accent = RGBA(hex: 0xAA8BEF)
            p.onAccent = RGBA(hex: 0x17111F)
            p.attention = RGBA(hex: 0xEBC683)
            p.problem = RGBA(hex: 0xF2A190)
            p.success = RGBA(hex: 0x74D6AE)
            p.live = RGBA(hex: 0x74D6AE)
            p.surfaceSolid = RGBA(hex: 0x17111F); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0x0E0A13), rail: RGBA(hex: 0x130E19), panel: RGBA(hex: 0x1F1629), work: RGBA(hex: 0x17111F), workspace: RGBA(hex: 0x1C1425), card: RGBA(hex: 0x261B31), bubble: RGBA(hex: 0x4E3D6A), palette: p)
        case .cobalt:
            var p = ThemePalette.daylight
            p.text = RGBA(hex: 0x182237)
            p.text2 = RGBA(hex: 0x495263)
            p.text3 = RGBA(hex: 0x626978)
            p.fill1 = RGBA(hex: 0xF8FAFD)
            p.fill2 = RGBA(hex: 0xFFFFFF)
            p.fill3 = RGBA(hex: 0xE8EBEF)
            p.border = RGBA(0.094118, 0.133333, 0.215686, 0.14)
            p.separator = RGBA(0.094118, 0.133333, 0.215686, 0.08)
            p.rim = RGBA(0.094118, 0.133333, 0.215686, 0.08)
            p.borderHover = RGBA(0.094118, 0.133333, 0.215686, 0.26)
            p.accent = RGBA(hex: 0x3658D6)
            p.onAccent = RGBA(hex: 0xFFFFFF)
            p.attention = RGBA(hex: 0x8A5A12)
            p.problem = RGBA(hex: 0x7A2614)
            p.success = RGBA(hex: 0x0E5E3F)
            p.live = RGBA(hex: 0x13805A)
            p.surfaceSolid = RGBA(hex: 0xF8FAFD); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0xE2E4E9), rail: RGBA(hex: 0x182237), panel: RGBA(hex: 0xFFFFFF), work: RGBA(hex: 0xF8FAFD), workspace: RGBA(hex: 0xEEF0F4), card: RGBA(hex: 0xFFFFFF), bubble: RGBA(hex: 0x182237), palette: p)
        case .teal:
            var p = ThemePalette.void
            p.text = RGBA(hex: 0xEFF9F6)
            p.text2 = RGBA(hex: 0xC3CECC)
            p.text3 = RGBA(hex: 0x9CA8A6)
            p.fill1 = RGBA(hex: 0x0F1B1B)
            p.fill2 = RGBA(hex: 0x142323)
            p.fill3 = RGBA(hex: 0x091010)
            p.border = RGBA(0.937255, 0.976471, 0.964706, 0.14)
            p.separator = RGBA(0.937255, 0.976471, 0.964706, 0.08)
            p.rim = RGBA(0.937255, 0.976471, 0.964706, 0.08)
            p.borderHover = RGBA(0.937255, 0.976471, 0.964706, 0.26)
            p.accent = RGBA(hex: 0x45C3AF)
            p.onAccent = RGBA(hex: 0x0B1515)
            p.attention = RGBA(hex: 0xEBC683)
            p.problem = RGBA(hex: 0xF2A190)
            p.success = RGBA(hex: 0x74D6AE)
            p.live = RGBA(hex: 0x74D6AE)
            p.surfaceSolid = RGBA(hex: 0x0B1515); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.fill1 = p.fill2
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 14; p.radiusControl = 9
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0x070D0D), rail: RGBA(hex: 0x091111), panel: RGBA(hex: 0x101D1D), work: RGBA(hex: 0x0B1515), workspace: RGBA(hex: 0x0E1A1A), card: RGBA(hex: 0x142323), bubble: RGBA(hex: 0x23534D), palette: p)
        default:
            let p = theme.palette
            return WorkspaceColors(frame: p.fill3.over(p.surfaceSolid), rail: p.fill1.over(p.surfaceSolid),
                panel: p.fill2.with(alpha: 0.35).over(p.surfaceSolid), work: p.surfaceSolid,
                workspace: p.fill1.over(p.surfaceSolid), card: p.fill2.over(p.surfaceSolid),
                bubble: p.accent.with(alpha: p.isDark ? 0.16 : 0.09).over(p.surfaceSolid), palette: p)
        }
    }
}
