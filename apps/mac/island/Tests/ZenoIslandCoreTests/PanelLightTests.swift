import Testing
@testable import ZenoIslandCore

@Suite struct PanelLightTests {
    /// The study's levels: rest 0.15, listening 0.30 breathing, thinking 0.24 slow breath, speaking 0.42, acting 0.30.
    @Test func brightnessFollowsTheStudy() {
        #expect(PanelLight(.ready) == PanelLight(.starting))
        #expect(PanelLight(.ready).brightness == 0.15 && PanelLight(.ready).breath == .still)
        #expect(PanelLight(.listening).brightness == 0.30 && PanelLight(.listening).breath == .normal)
        #expect(PanelLight(.thinking).brightness == 0.24 && PanelLight(.thinking).breath == .slow)
        #expect(PanelLight(.transcribing) == PanelLight(.thinking))
        #expect(PanelLight(.speaking).brightness == 0.42 && PanelLight(.speaking).breath == .still)
        #expect(PanelLight(.acting).brightness == 0.30)
    }

    /// Speaking burns brightest; a problem dims the light below rest.
    @Test func speakingIsBrightestAndAProblemDims() {
        let all: [IslandStatus.Kind] = [.starting, .ready, .listening, .transcribing, .thinking, .speaking, .notice, .problem, .acting, .asking]
        let brightest = all.max { PanelLight($0).brightness < PanelLight($1).brightness }
        #expect(brightest == .speaking)
        #expect(PanelLight(.problem).brightness < PanelLight(.ready).brightness)
        #expect(all.allSatisfy { (0...1).contains(PanelLight($0).brightness) })
    }

    /// The header's Wisp shows the pet's mood for each state; idle states rest.
    @Test func headerMoodMatchesThePet() {
        #expect(PetBrain.mood(for: .listening) == .listening)
        #expect(PetBrain.mood(for: .asking) == .thinking)
        #expect(PetBrain.mood(for: .speaking) == .speaking)
        #expect(PetBrain.mood(for: .problem) == .worried)
        #expect(PetBrain.mood(for: .ready) == nil)
    }
}
