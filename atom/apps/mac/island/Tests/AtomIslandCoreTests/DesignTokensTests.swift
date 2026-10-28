import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15: design/atom-design-system/tokens.css describes the two flat themes. It must not drift from `Theme.swift`.
@Suite("Design tokens")
struct DesignTokensTests {
    /// The repository root, found from this file: …/apps/mac/island/Tests/AtomIslandCoreTests/<this file>.
    static var tokensURL: URL {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("design/atom-design-system/tokens.css")
    }

    /// `selector -> [token: value]` for the blocks of the file (comments removed).
    static func blocks(_ css: String) -> [String: [String: String]] {
        let clean = css.replacingOccurrences(of: #"/\*[\s\S]*?\*/"#, with: "", options: .regularExpression)
        var result = [String: [String: String]]()
        for part in clean.split(separator: "}") {
            let pieces = part.split(separator: "{", maxSplits: 1).map(String.init)
            guard pieces.count == 2 else { continue }
            var tokens = [String: String]()
            for line in pieces[1].split(separator: ";") {
                let pair = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                if pair.count == 2, pair[0].hasPrefix("--") { tokens[pair[0]] = pair[1] }
            }
            for selector in pieces[0].split(separator: ",") { result[selector.trimmingCharacters(in: .whitespacesAndNewlines), default: [:]].merge(tokens) { $1 } }
        }
        return result
    }

    static func color(_ value: String?) -> RGBA? {
        guard let value, value.hasPrefix("#"), value.count == 7, let hex = UInt32(value.dropFirst(), radix: 16) else { return nil }
        return RGBA(hex: hex)
    }

    static func pixels(_ value: String?) -> CGFloat? {
        guard let value, value.hasSuffix("px"), let n = Double(value.dropLast(2)) else { return nil }
        return CGFloat(n)
    }

    @Test(arguments: [("[data-theme=\"void\"]", AppTheme.void), ("[data-theme=\"daylight\"]", AppTheme.daylight)])
    func theTokensMatchTheSwiftTheme(selector: String, theme: AppTheme) throws {
        let css = try String(contentsOf: Self.tokensURL, encoding: .utf8)
        let tokens = try #require(Self.blocks(css)[selector], "tokens.css has a block for \(selector)")
        let p = theme.palette
        let expected: [(String, RGBA)] = [
            ("--bg", p.surfaceSolid), ("--surface", p.surfaceSolid), ("--surface-2", p.fill2.over(p.surfaceSolid)), ("--surface-3", p.fill3.over(p.surfaceSolid)),
            ("--border", p.border), ("--border-hover", p.borderHover),
            ("--fg", p.text), ("--fg-2", p.text2), ("--fg-3", p.text3),
            ("--accent", p.accent), ("--accent-on", p.onAccent),
            ("--live", p.live), ("--warn", p.attention), ("--danger", p.problem), ("--success", p.success),
            ("--identifier", p.identifier ?? p.accent),
        ]
        for (name, want) in expected {
            let got = try #require(Self.color(tokens[name]), "\(selector) \(name) is a #RRGGBB colour")
            #expect(got == want.over(p.surfaceSolid), "\(selector) \(name) equals the \(theme.title) palette")
        }
        #expect(Self.pixels(tokens["--radius-lg"]) == p.radiusSurface, "\(selector) --radius-lg")
        #expect(Self.pixels(tokens["--radius-md"]) == p.radiusCard, "\(selector) --radius-md")
        #expect(Self.pixels(tokens["--radius-sm"]) == p.radiusControl, "\(selector) --radius-sm")
    }

    @Test func spacingIsOnAFourPixelGridAndRadiiStepDown() throws {
        let css = try String(contentsOf: Self.tokensURL, encoding: .utf8)
        let shared = try #require(Self.blocks(css)[":root"])
        let spaces = shared.filter { $0.key.hasPrefix("--space-") }.compactMap { Self.pixels($0.value) }
        #expect(spaces.count == 7 && spaces.allSatisfy { $0.truncatingRemainder(dividingBy: 4) == 0 }, "every --space-* is a multiple of 4 px")
        for selector in ["[data-theme=\"void\"]", "[data-theme=\"daylight\"]"] {
            let t = try #require(Self.blocks(css)[selector])
            let (lg, md, sm) = (try #require(Self.pixels(t["--radius-lg"])), try #require(Self.pixels(t["--radius-md"])), try #require(Self.pixels(t["--radius-sm"])))
            #expect(lg > md && md > sm, "\(selector) radii step down so corners stay concentric")
        }
    }

    @Test func secondaryTextIsSofterThanMainTextInEveryTheme() throws {
        let css = try String(contentsOf: Self.tokensURL, encoding: .utf8)
        for selector in ["[data-theme=\"void\"]", "[data-theme=\"daylight\"]"] {
            let t = try #require(Self.blocks(css)[selector])
            let bg = try #require(Self.color(t["--bg"])), fg = try #require(Self.color(t["--fg"])), fg2 = try #require(Self.color(t["--fg-2"]))
            #expect(RGBA.contrast(fg2, bg) < RGBA.contrast(fg, bg), "\(selector) --fg-2 is softer than --fg")
            #expect(RGBA.contrast(fg, bg) >= 7 && RGBA.contrast(fg2, bg) >= 4.5, "\(selector) text contrast")
        }
    }
}
