import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("Wisp's curved flight (ADR-077)")
struct WispFlightTests {
    private let start = CGPoint(x: 100, y: 200)
    private let end = CGPoint(x: 700, y: 200)

    @Test func startsAtTheStart() {
        let f = WispFlight(from: start, to: end, at: 10)
        #expect(f.position(at: 10) == start)
        #expect(f.position(at: 5) == start) // before it starts
    }

    @Test func endsExactlyAtTheEnd() {
        let f = WispFlight(from: CGPoint(x: 13.7, y: 91.3), to: CGPoint(x: 1234.5, y: 777.7), at: 3)
        #expect(f.position(at: 3 + f.duration) == f.end)
        #expect(f.position(at: 100) == f.end)
        #expect(f.isDone(at: 3 + f.duration))
        #expect(!f.isDone(at: 3 + f.duration / 2))
    }

    @Test func theMiddleRisesAboveTheStraightLine() {
        let f = WispFlight(from: start, to: end, at: 0)
        let mid = f.position(at: f.duration / 2)
        #expect(abs(mid.x - 400) < 0.001)
        #expect(mid.y > 200 + 50) // arc height 0.25 × 600 = 150 at the control point, 75 on the curve
    }

    @Test func archesUpwardEvenWhenFlyingDown() {
        let f = WispFlight(from: CGPoint(x: 0, y: 800), to: CGPoint(x: 400, y: 0), at: 0)
        let mid = f.position(at: f.duration / 2)
        #expect(mid.y > 400) // above the straight line's midpoint
    }

    @Test func theArcHeightIsCapped() {
        let f = WispFlight(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 3000, y: 0), at: 0)
        let mid = f.position(at: f.duration / 2)
        #expect(mid.y <= WispFlight.maxArc / 2 + 0.001)
        #expect(mid.y > WispFlight.maxArc / 2 - 0.001)
    }

    @Test func durationGrowsWithDistanceWithinBounds() {
        let short = WispFlight(from: .zero, to: CGPoint(x: 10, y: 0), at: 0)
        let medium = WispFlight(from: .zero, to: CGPoint(x: 500, y: 0), at: 0)
        let long = WispFlight(from: .zero, to: CGPoint(x: 5000, y: 0), at: 0)
        #expect(abs(short.duration - 0.608) < 0.0001)
        #expect(abs(medium.duration - 1.0) < 0.0001)
        #expect(long.duration == 1.4)
        #expect(short.duration >= 0.6 && long.duration <= 1.4)
    }

    @Test func smoothstepIsMonotonicAndPinned() {
        #expect(WispFlight.smoothstep(0) == 0)
        #expect(WispFlight.smoothstep(1) == 1)
        #expect(WispFlight.smoothstep(-1) == 0)
        #expect(WispFlight.smoothstep(2) == 1)
        var last = -1.0
        for i in 0...100 {
            let v = WispFlight.smoothstep(Double(i) / 100)
            #expect(v >= last)
            last = v
        }
    }

    @Test func aZeroDistanceFlightIsDoneImmediately() {
        let f = WispFlight(from: start, to: start, at: 4)
        #expect(f.isDone(at: 4))
        #expect(f.position(at: 4) == start)
        #expect(f.lean(at: 4) == 0)
    }

    @Test func theTangentClimbsThenDescends() {
        let f = WispFlight(from: start, to: end, at: 0)
        #expect(f.tangentAngle(at: 0.01) > 0) // rising
        #expect(abs(f.tangentAngle(at: f.duration / 2)) < 0.001) // level at the top
        #expect(f.tangentAngle(at: f.duration - 0.01) < 0) // coming down
        let back = WispFlight(from: end, to: start, at: 0)
        #expect(abs(abs(back.tangentAngle(at: back.duration / 2)) - .pi) < 0.001) // level, heading left
    }

    @Test func theLeanIsSmallFollowsTheDirectionAndFadesAtBothEnds() {
        let right = WispFlight(from: start, to: end, at: 0)
        let left = WispFlight(from: end, to: start, at: 0)
        #expect(right.lean(at: right.duration / 2) > 0)
        #expect(left.lean(at: left.duration / 2) < 0)
        #expect(abs(right.lean(at: right.duration / 2)) <= WispFlight.maxLean + 0.0001)
        #expect(right.lean(at: 0) == 0)
        #expect(right.lean(at: right.duration) == 0)
    }
}
