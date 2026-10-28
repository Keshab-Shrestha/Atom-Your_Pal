import Testing
@testable import AtomIslandCore

@Suite struct MenuBarLightTests {
    /// ADR-084: one Pal glyph; lit while listening, amber when Pal needs you, coral on a problem, plain otherwise.
    @Test func eachStateLightsTheGlyphOrLeavesItPlain() {
        let expected: [(IslandStatus.Kind, MenuBarLight)] = [
            (.starting, .plain), (.ready, .plain), (.listening, .lit), (.transcribing, .plain), (.thinking, .plain),
            (.speaking, .plain), (.notice, .attention), (.problem, .problem), (.acting, .plain), (.asking, .attention),
        ]
        for (kind, light) in expected {
            #expect(MenuBarLight(kind) == light, "\(kind)")
        }
        #expect(MenuBarLight.plain.isTemplate)
        #expect(!MenuBarLight.lit.isTemplate && !MenuBarLight.attention.isTemplate && !MenuBarLight.problem.isTemplate)
    }
}
