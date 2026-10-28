import Foundation

/// What a panel needs to look like the app: the scheme, eleven colour tokens, the text size and the motion setting.
/// Tokens are opaque colours worked out from the theme, so the page never lays a translucent colour over unknown ground.
public struct WebPanelTheme: Equatable, Sendable {
    public static let minTextScale = 0.8
    public static let maxTextScale = 2.0

    public let scheme: String
    public let tokens: [String: String]
    public let textScale: Double
    public let reduceMotion: Bool

    /// `background` is the ground the page sits on, when it is not the window's (a workspace pane has its own).
    public init(palette: ThemePalette, textScale: CGFloat, reduceMotion: Bool, background: RGBA? = nil) {
        let base = background?.over(palette.surfaceSolid) ?? palette.surfaceSolid
        func css(_ colour: RGBA) -> String {
            let solid = colour.over(base)
            func channel(_ value: Double) -> Int { min(255, max(0, Int((value * 255).rounded()))) }
            return "rgb(\(channel(solid.r)) \(channel(solid.g)) \(channel(solid.b)))"
        }
        scheme = palette.isDark ? "dark" : "light"
        tokens = [
            "--bg": css(base), "--panel": css(palette.fill1), "--text": css(palette.text), "--muted": css(palette.text2),
            "--quiet": css(palette.text3), "--line": css(palette.separator), "--fill": css(palette.fill2),
            "--accent": css(palette.accent), "--accent-text": css(palette.accent), "--green": css(palette.success),
            "--blue": css(palette.accent),
        ]
        self.textScale = min(Self.maxTextScale, max(Self.minTextScale, Double(textScale)))
        self.reduceMotion = reduceMotion
    }
}

/// The host to panel half of docs/web-panel-contract.md. Each message is a JSON object that the app passes to
/// `window.atomPanel.receive` as an argument, never as built script text.
public enum WebPanelHost {
    public static func initMessage(panel: String, theme: WebPanelTheme) -> [String: Any] {
        var message = themeFields(theme)
        message["v"] = WebPanelMessage.version
        message["type"] = "init"
        message["panel"] = panel
        return message
    }

    public static func themeMessage(_ theme: WebPanelTheme) -> [String: Any] {
        var message = themeFields(theme)
        message["v"] = WebPanelMessage.version
        message["type"] = "theme"
        return message
    }

    /// `revision` always rises; the page ignores a message that is not newer.
    public static func dataMessage(revision: Int, payload: [String: Any]) -> [String: Any] {
        ["v": WebPanelMessage.version, "type": "data", "revision": revision, "payload": payload]
    }

    public static func resetMessage() -> [String: Any] {
        ["v": WebPanelMessage.version, "type": "reset"]
    }

    private static func themeFields(_ theme: WebPanelTheme) -> [String: Any] {
        ["scheme": theme.scheme, "tokens": theme.tokens, "textScale": theme.textScale, "reduceMotion": theme.reduceMotion]
    }
}
