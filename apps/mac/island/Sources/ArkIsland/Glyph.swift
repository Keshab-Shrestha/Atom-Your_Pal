import SwiftUI
import ArkIslandCore

/// An icon in the app's chrome (2026-11-01 redesign). It draws Flaticon's UIcons (Regular Rounded) when that font is on this Mac, at the
/// size of the text around it, and Apple's SF Symbol otherwise, so an icon is never missing.
///
/// The font is not in the repository: its licence (Flaticon License, free with credit, non-transferable) covers a copy each person
/// downloads for their own Mac. `scripts/setup.sh` downloads it into `assets/fonts/vendor/` (git-ignored); Settings → About credits
/// "Uicons by Flaticon". `ARK_UICONS=0` forces SF Symbols (the visual check uses it, so its golden shots match on every machine).
struct Glyph: View {
    let systemName: String
    @Environment(\.glyphPointSize) private var size

    init(systemName: String) { self.systemName = systemName }

    var body: some View {
        if let character = UIcons.character(for: systemName) {
            Text(String(character))
                .font(.custom(UIcons.family, fixedSize: (size * 1.1).rounded()))
                .accessibilityLabel(systemName.replacingOccurrences(of: ".", with: " "))
        } else {
            Image(systemName: systemName)
        }
    }
}

enum UIcons {
    static let family = "uicons-regular-rounded"
    /// Shown in Settings → About when the font is in use (the licence's credit).
    static let credit = "Uicons by Flaticon (www.flaticon.com)"

    static var inUse: Bool { enabled }
    private static let enabled: Bool = ArkEnv.read("ARK_UICONS") != "0" && AppFonts.has(family)

    static func character(for systemName: String) -> Character? {
        guard enabled, let code = map[systemName], let scalar = Unicode.Scalar(code) else { return nil }
        return Character(scalar)
    }

    /// SF Symbol name → UIcons Regular Rounded codepoint (from the package's `css/regular/rounded.css`, version 3.3.1).
    /// A symbol not listed here stays an SF Symbol.
    private static let map: [String: UInt32] = [
        "chevron.right": 0xF155, "chevron.left": 0xF154, "chevron.down": 0xF153, "chevron.up": 0xF156,
        "chevron.up.chevron.down": 0xFC69,
        "xmark": 0xF4F6, "xmark.circle.fill": 0xF4F4,
        "magnifyingglass": 0xFBBA,
        "checkmark": 0xF3C8, "checkmark.circle": 0xF3C4, "checkmark.circle.fill": 0xF3C4,
        "brain": 0xF2DE, "brain.head.profile": 0xF2DE,
        "square.grid.2x2": 0xF16C,
        "sparkles": 0xFC84,
        "sidebar.left": 0xFC08, "sidebar.right": 0xFC07,
        "plus": 0xFAAB,
        "folder": 0xF6BA,
        "ellipsis": 0xF927,
        "doc": 0xF57A, "doc.on.doc": 0xF4DD,
        "wifi": 0xFF08,
        "trash": 0xFE17,
        "terminal": 0xFD78,
        "stop": 0xFCFA,
        "square.and.pencil": 0xFA24, "pencil": 0xFA29,
        "pin.fill": 0xFD95,
        "person.2": 0xFEA6, "person.2.wave.2": 0xFEA1,
        "paperclip": 0xF437,
        "link": 0xF8BA,
        "globe": 0xF705,
        "gearshape": 0xFBD2,
        "exclamationmark": 0xF5EB, "exclamationmark.triangle.fill": 0xFE33,
        "info.circle": 0xF80B,
        "clock": 0xF45A, "clock.arrow.circlepath": 0xFDAA,
        "circle.dashed": 0xFC8F,
        "arrow.up.right": 0xF1B4, "arrow.up.forward.square": 0xF1B4,
        "arrow.up": 0xF19F, "arrow.right": 0xF19B,
        "arrow.clockwise": 0xFB34, "arrow.uturn.backward": 0xFE6B, "arrow.down.to.line": 0xF591,
        "arrow.triangle.branch": 0xF482,
        "point.topleft.down.to.point.bottomright.curvepath": 0xFB6F,
        "archivebox": 0xF16D,
        "text.bubble": 0xF4A1,
        "pause.circle": 0xFA0A,
        "keyboard.badge.ellipsis": 0xF84C,
        "hourglass": 0xF7CA,
        "mic": 0xF944, "mic.fill": 0xF944,
        "calendar": 0xF339, "bell": 0xF239, "house": 0xF7B8,
        "crown": 0xF4F9, "questionmark": 0xFAF3,
    ]
}
