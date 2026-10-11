import Foundation
import Testing
@testable import ZenoIslandCore

/// ADR-089: Pal's character from its avatar definition, and its animations.
@Suite("Pal character")
struct PalCharacterTests {
    static let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../../assets/pals")

    func load(_ id: String) throws -> PalDefinition {
        try PalDefinition.decode(Data(contentsOf: Self.file.appendingPathComponent("\(id).json")))
    }

    @Test func readsPalsDefinition() throws {
        let pal = try load("pal")
        #expect(pal.name == "Strobi copy")
        #expect(pal.body.primary.type == "cube" && pal.body.nodes.count == 6)
        #expect(pal.expressions.count == 28 && pal.animations.count == 23)
        #expect(PalRGB(hex: pal.colors.body) == PalRGB(r: 245.0 / 255, g: 245.0 / 255, b: 245.0 / 255))
        for id in ["sid", "kame", "puff", "quill", "penny", "hana", "tinker"] {
            let worker = try load(id)
            #expect(worker.colors.body != pal.colors.body, "\(id) has its own colours")
            #expect(worker.animations.keys.sorted() == pal.animations.keys.sorted(), "\(id) has every animation")
        }
    }

    @Test func stepsHoldThenEaseIntoTheNext() throws {
        let pal = try load("pal")
        let idle = pal.animations["idle"]!
        let first = PalPose.of(pal.expressions[idle.steps[0].expression]!, in: pal)
        let second = PalPose.of(pal.expressions[idle.steps[1].expression]!, in: pal)
        // Step 1 eases in for 0.5 s then holds 5.2 s; step 2 starts at 5.7 s.
        #expect(PalPose.at(pal, animation: "idle", time: 3.0).headY == first.headY)
        #expect(PalPose.at(pal, animation: "idle", time: 5.7 + 0.6).headY == second.headY)
        let halfway = PalPose.at(pal, animation: "idle", time: 5.7 + 0.25).headY
        #expect(halfway > min(first.headY, second.headY) && halfway < max(first.headY, second.headY))
        #expect(PalPose.at(pal, animation: "idle", time: 11.4 + 3).headY == first.headY, "it loops")
    }

    @Test func expressionColoursAndMotionCarryThrough() throws {
        let pal = try load("pal")
        let angry = PalPose.of(pal.expressions["angry-brows"]!, in: pal)
        #expect(angry.body == PalRGB(hex: "#ba3636") && angry.bodyMotion == "shake")
        let neutral = PalPose.at(pal, animation: "no such animation", time: 9)
        #expect(neutral.left == pal.expressions["neutral"]!.eyes.left)
    }

    @Test func blinksComeAndGo() throws {
        let pal = try load("pal")
        let blink = pal.animations["idle"]!.blink!
        #expect(PalPose.blink(blink, time: 1) == 0, "not before the first delay")
        let samples = stride(from: 0.0, to: 60, by: 0.02).map { PalPose.blink(blink, time: $0) }
        #expect(samples.contains { $0 > 0.9 } && samples.filter { $0 > 0 }.count < samples.count / 5)
    }

    @Test func momentsPickAnimations() {
        #expect(PalAnimation.name(mood: .listening, reaction: nil) == "listening")
        #expect(PalAnimation.name(mood: .napping, reaction: nil) == "sleeping")
        #expect(PalAnimation.name(mood: .resting, reaction: .hello) == "celebrate")
        #expect(PalAnimation.worker(running: true) == "working")
        #expect(PalAnimation.agentColor(for: "rumi") == PalAnimation.agentColor(for: "rumi"))
    }
}
