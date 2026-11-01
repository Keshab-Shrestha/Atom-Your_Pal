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
        case .ember:
            // The reference app: near-black graphite lanes, white text at three strengths, hairlines at 8%, and
            // orange only for the one thing in focus.
            var p = ThemePalette.void
            p.text = RGBA(hex: 0xECECEC)
            p.text2 = RGBA(hex: 0xA3A3A3)
            p.text3 = RGBA(hex: 0x8A8A8A)
            p.fill1 = RGBA(hex: 0x1B1B1B)
            p.fill2 = RGBA(hex: 0x222222)
            p.fill3 = RGBA(hex: 0x2A2A2A)
            p.border = RGBA(1, 1, 1, 0.10)
            p.separator = RGBA(1, 1, 1, 0.07)
            p.rim = RGBA(1, 1, 1, 0.07)
            p.borderHover = RGBA(1, 1, 1, 0.22)
            p.accent = RGBA(hex: 0xF26B2C)
            p.onAccent = RGBA(hex: 0x111111)
            p.attention = RGBA(hex: 0xF2B544)
            p.problem = RGBA(hex: 0xF28B82)
            p.success = RGBA(hex: 0x5FD08F)
            p.live = RGBA(hex: 0x7CB8FF)
            p.surfaceSolid = RGBA(hex: 0x131313); p.surface = p.surfaceSolid; p.surfaceTop = nil
            p.accentEnd = p.accent; p.identifier = nil; p.monoIdentifiers = false
            p.radiusSurface = 14; p.radiusCard = 12; p.radiusControl = 8
            p.buttonStyle = .filled; p.usesGlow = false; p.usesShadows = true
            return WorkspaceColors(frame: RGBA(hex: 0x0C0C0C), rail: RGBA(hex: 0x171717), panel: RGBA(hex: 0x171717), work: RGBA(hex: 0x131313),
                                   workspace: RGBA(hex: 0x161616), card: RGBA(hex: 0x1B1B1B), bubble: RGBA(hex: 0x262626), palette: p)
        default:
            let p = theme.palette
            return WorkspaceColors(frame: p.fill3.over(p.surfaceSolid), rail: p.fill1.over(p.surfaceSolid),
                panel: p.fill2.with(alpha: 0.35).over(p.surfaceSolid), work: p.surfaceSolid,
                workspace: p.fill1.over(p.surfaceSolid), card: p.fill2.over(p.surfaceSolid),
                bubble: p.accent.with(alpha: p.isDark ? 0.16 : 0.09).over(p.surfaceSolid), palette: p)
        }
    }
}
