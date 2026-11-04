import Testing
@testable import ArkIslandCore

@Suite("Audio duck")
struct AudioDuckTests {
    @Test("listening lowers the volume to a quarter and the end restores it")
    func lowersAndRestores() {
        var duck = AudioDuck()
        #expect(duck.begin(current: 80) == 20)
        #expect(duck.isDucked)
        #expect(duck.end(current: 20) == 80)
        #expect(!duck.isDucked)
    }

    @Test("a volume the user changed meanwhile is left alone")
    func respectsTheUser() {
        var duck = AudioDuck()
        _ = duck.begin(current: 60)
        #expect(duck.end(current: 55) == nil)
        #expect(duck.end(current: 15) == nil, "ending twice does nothing")
    }

    @Test("a quiet or unreadable volume is not touched, and a second begin does not stack")
    func edge() {
        var duck = AudioDuck()
        #expect(duck.begin(current: 3) == nil)
        #expect(duck.begin(current: nil) == nil)
        #expect(!duck.isDucked)
        #expect(duck.begin(current: 40) == 10)
        #expect(duck.begin(current: 10) == nil, "already ducked")
        #expect(duck.end(current: 10) == 40)
    }
}
