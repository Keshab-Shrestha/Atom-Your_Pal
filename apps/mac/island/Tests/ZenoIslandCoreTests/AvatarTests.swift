import Foundation
import Testing
@testable import ZenoIslandCore

/// Avatars (ADR-085): which image each moment shows, the files' names, the fallbacks, the speaking mouth, and the
/// Avatar style becoming the default once Pal's images exist.
@Suite("Avatars")
struct AvatarTests {
    @Test func fileNamesMatchTheSpec() {
        #expect(AvatarExpression.pal.map(\.fileName) == [
            "neutral.png", "happy.png", "listening.png", "thinking.png", "speaking.png", "speaking-closed.png",
            "worried.png", "sleepy.png", "surprised.png",
        ])
        #expect(AvatarExpression.helper.map(\.fileName) == ["neutral.png", "working.png", "happy.png", "worried.png"])
    }

    @Test func palMoods() {
        let expected: [(PetBrain.Mood, AvatarExpression)] = [
            (.resting, .neutral), (.floating, .neutral), (.listening, .listening), (.thinking, .thinking),
            (.worried, .worried), (.napping, .sleepy), (.carried, .surprised),
        ]
        for (mood, expression) in expected {
            #expect(AvatarExpression.pal(mood: mood, reaction: nil, mouthOpen: true) == expression)
        }
        #expect(AvatarExpression.pal(mood: .speaking, reaction: nil, mouthOpen: true) == .speaking)
        #expect(AvatarExpression.pal(mood: .speaking, reaction: nil, mouthOpen: false) == .speakingClosed)
    }

    @Test func reactionsWinOverTheIdleMood() {
        #expect(AvatarExpression.pal(mood: .resting, reaction: .hello, mouthOpen: false) == .happy)
        #expect(AvatarExpression.pal(mood: .resting, reaction: .squish, mouthOpen: false) == .surprised)
        #expect(AvatarExpression.pal(mood: .floating, reaction: .dizzy, mouthOpen: false) == .surprised)
        #expect(AvatarExpression.pal(mood: .napping, reaction: .yawn, mouthOpen: false) == .sleepy)
    }

    @Test func fallbacksEndAtNeutral() {
        #expect(AvatarExpression.neutral.fallbacks == [.neutral])
        #expect(AvatarExpression.speakingClosed.fallbacks == [.speakingClosed, .speaking, .neutral])
        for expression in AvatarExpression.allCases where expression != .neutral {
            #expect(expression.fallbacks.first == expression)
            #expect(expression.fallbacks.last == .neutral)
        }
    }

    @Test func helperFollowsItsJobs() {
        func helper(_ states: [JobState]) -> Helper {
            Helper(id: "sid", name: "Sid", available: true, app: nil,
                   jobs: states.enumerated().map { HelperJob(id: $0.offset, task: "t", state: $0.element) })
        }
        #expect(AvatarExpression.helper(helper([])) == .neutral)
        #expect(AvatarExpression.helper(helper([.queued, .running, .done])) == .working) // a newer queued job: still working
        #expect(AvatarExpression.helper(helper([.done, .failed])) == .happy)
        #expect(AvatarExpression.helper(helper([.failed, .done])) == .worried)
        #expect(AvatarExpression.helper(helper([.stopped])) == .neutral)
        #expect(AvatarExpression.helper(helper([.queued])) == .neutral)
    }

    @Test func pathsStayInsideTheFolder() {
        #expect(AvatarExpression.working.path(character: "sid") == "sid/working.png")
        #expect(AvatarExpression.speakingClosed.path(character: "pal") == "pal/speaking-closed.png")
        for bad in ["", "../pal", "a/b", "Sid", ".", String(repeating: "a", count: 33)] {
            #expect(AvatarExpression.neutral.path(character: bad) == nil)
        }
    }

    /// The mouth alternates about 6-8 times a second, both open and closed, and unevenly.
    @Test func speakingMouthAlternatesAtSpeechRate() {
        var changes = 0
        var open = Set<Bool>()
        var runs: [Int] = []
        var run = 0
        var last = AvatarExpression.mouthOpen(at: 10)
        for ms in 1...2000 {
            let now = AvatarExpression.mouthOpen(at: 10 + Double(ms) / 1000)
            open.insert(now)
            run += 1
            if now != last { changes += 1; runs.append(run); run = 0 }
            last = now
        }
        let openingsPerSecond = Double(changes) / 2 / 2
        #expect(open == [true, false])
        #expect(openingsPerSecond >= 6 && openingsPerSecond <= 8)
        #expect(Set(runs.dropFirst()).count > 2) // not a metronome
        #expect(AvatarExpression.mouthOpen(at: -0.01) == AvatarExpression.mouthOpen(at: AvatarExpression.mouthCycle - 0.01))
    }

    /// ADR-089: Pal's character is the default, once, whatever was stored; a choice made afterwards is kept.
    @MainActor @Test func characterIsTheDefaultAndTakesOverOnce() {
        let suite = "zeno.test.avatar.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(PalStyle.ghost.rawValue, forKey: "zeno.wisp.style")
        let settings = IslandSettings(defaults: defaults, palAvatar: true)
        #expect(settings.palStyle == .character)
        settings.palStyle = .avatar
        #expect(IslandSettings(defaults: defaults, palAvatar: true).palStyle == .avatar, "a later choice is kept")
        settings.resetAppearance()
        #expect(settings.palStyle == .character)
    }

    /// A stored Orb (the old default) moves to Avatar once when the images arrive; choosing Orb again is kept, and
    /// Ghost or Companion are never moved.
    @MainActor @Test func storedOrbMovesToAvatarOnce() {
        let suite = "zeno.test.avatar.move.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let before = IslandSettings(defaults: defaults)
        before.palStyle = .orb
        _ = IslandSettings(defaults: defaults) // no images yet: nothing moves, and the move is not used up
        #expect(IslandSettings(defaults: defaults).palStyle == .orb)
        let moved = IslandSettings(defaults: defaults, palAvatar: true)
        #expect(moved.palStyle == .avatar)
        moved.palStyle = .orb
        #expect(IslandSettings(defaults: defaults, palAvatar: true).palStyle == .orb)

        let other = "zeno.test.avatar.ghost.\(UUID().uuidString)"
        let ghostDefaults = UserDefaults(suiteName: other)!
        defer { ghostDefaults.removePersistentDomain(forName: other) }
        IslandSettings(defaults: ghostDefaults).palStyle = .ghost
        #expect(IslandSettings(defaults: ghostDefaults, palAvatar: true).palStyle == .ghost)
    }
}
