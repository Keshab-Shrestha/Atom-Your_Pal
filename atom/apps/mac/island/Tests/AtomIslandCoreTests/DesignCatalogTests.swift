import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-124: the Design system page lists every token from one catalog. The catalog must say exactly what
/// design/atom-design-system/tokens.css says, so the page, the CSS and the Swift themes cannot drift apart.
@Suite("Design catalog")
struct DesignCatalogTests {
    static func css() throws -> String { try String(contentsOf: DesignTokensTests.tokensURL, encoding: .utf8) }

    /// The tokens a theme sees: the shared `:root` block with the theme's own block over it.
    static func fileTokens(_ theme: AppTheme) throws -> [String: String] {
        let blocks = DesignTokensTests.blocks(try css())
        let selector = "[data-theme=\"\(theme == .daylight ? "daylight" : "void")\"]"
        let own = try #require(blocks[selector], "tokens.css has a block for \(selector)")
        return (blocks[":root"] ?? [:]).merging(own) { $1 }
    }

    @Test(arguments: DesignPreviewTheme.allCases)
    func theCatalogSaysWhatTokensCSSSays(preview: DesignPreviewTheme) throws {
        let file = try Self.fileTokens(preview.theme)
        let catalog = DesignCatalog.tokens(for: preview.theme)
        for token in catalog {
            let value = try #require(file[token.name], "tokens.css has \(token.name) (\(preview.title))")
            #expect(token.cssValue == value, "\(preview.title) \(token.name): catalog \(token.cssValue), tokens.css \(value)")
        }
        let listed = Set(catalog.map(\.name))
        for name in file.keys.sorted() {
            #expect(listed.contains(name), "\(preview.title): \(name) is in tokens.css but not on the Design system page")
        }
        #expect(listed.count == catalog.count, "each token is listed once")
    }

    /// The page's colours are the Swift theme's, laid over the window as the views draw them.
    @Test(arguments: DesignPreviewTheme.allCases)
    func colourTokensComeFromTheSwiftPalette(preview: DesignPreviewTheme) throws {
        let p = preview.theme.palette
        let tokens = Dictionary(uniqueKeysWithValues: DesignCatalog.tokens(for: preview.theme).map { ($0.name, $0) })
        let fg = try #require(tokens["--fg"]?.color)
        #expect(fg == p.text.over(p.surfaceSolid))
        #expect(try #require(tokens["--surface-2"]?.color) == p.fill2.over(p.surfaceSolid))
        #expect(try #require(tokens["--identifier"]?.color) == (p.identifier ?? p.accent).over(p.surfaceSolid))
        #expect(try #require(tokens["--radius-md"]?.points) == p.radiusCard)
    }

    /// Text and status colours carry their contrast on the window, so the page shows the number a test checks.
    @Test(arguments: DesignPreviewTheme.allCases)
    func textTokensCarryTheirContrast(preview: DesignPreviewTheme) throws {
        let tokens = Dictionary(uniqueKeysWithValues: DesignCatalog.tokens(for: preview.theme).map { ($0.name, $0) })
        let bg = try #require(tokens["--bg"]?.color)
        for name in ["--fg", "--fg-2", "--fg-3", "--live", "--warn", "--danger", "--success", "--identifier"] {
            let token = try #require(tokens[name])
            let contrast = try #require(token.contrast, "\(name) has a contrast")
            #expect(abs(contrast - RGBA.contrast(try #require(token.color), bg)) < 0.001)
            #expect(contrast >= 4.5, "\(preview.title) \(name) reads at 4.5:1 or more (\(contrast))")
        }
        #expect(try #require(tokens["--fg"]?.contrast) >= 7)
        #expect(tokens["--bg"]?.contrast == nil, "a surface has no contrast against itself")
    }

    @Test func everyTokenHasAGroupARoleAndAValueToShow() {
        for theme in DesignPreviewTheme.allCases.map(\.theme) {
            for token in DesignCatalog.tokens(for: theme) {
                #expect(token.name.hasPrefix("--"))
                #expect(!token.role.isEmpty, "\(token.name) says what it is for")
                #expect(!token.display.isEmpty)
            }
            #expect(Set(DesignCatalog.tokens(for: theme).map(\.group)) == Set(DesignToken.Group.allCases), "every group has tokens")
        }
    }

    /// DESIGN.md section 3: one type scale, each size for one role.
    @Test func theTypeScaleIsTheOneInDesignMD() {
        #expect(DesignCatalog.typeScale.map(\.size) == [11, 12, 13, 15, 18, 26])
        #expect(Set(DesignCatalog.typeScale.map(\.role)).count == DesignCatalog.typeScale.count)
    }

    /// The page previews Void or Daylight; any other theme previews Void, the default.
    @Test func thePreviewStartsOnTheCurrentFlatTheme() {
        #expect(DesignPreviewTheme(current: .daylight) == .daylight)
        #expect(DesignPreviewTheme(current: .void) == .void)
        #expect(DesignPreviewTheme(current: .lantern) == .void)
        #expect(DesignPreviewTheme(current: .warm) == .void)
    }

    @Test func coloursPrintAsHex() {
        #expect(RGBA(hex: 0x5B50E6).hex == "#5B50E6")
        #expect(RGBA(hex: 0x000000).hex == "#000000")
        #expect(RGBA.white(1).hex == "#FFFFFF")
    }

    @Test func aTokenCopiesAsItsCSSVariable() throws {
        let fg = try #require(DesignCatalog.tokens(for: .void).first { $0.name == "--fg" })
        #expect(fg.cssVariable == "var(--fg)")
        #expect(fg.display == "#F0F0F0")
    }
}
