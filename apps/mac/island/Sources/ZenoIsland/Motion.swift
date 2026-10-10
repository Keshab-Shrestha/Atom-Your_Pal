import SwiftUI

/// ZENO's named motion (ADR-084, design study §3): one small family of springs, so everything moves as if made by
/// one hand. Things arrive with a little life and leave without fuss: nothing springs on the way out.
/// Every name takes Reduce Motion: springs become a plain 0.15 s ease-out, breathing stops, cascades collapse.
enum Motion {
    /// The Reduce Motion fallback for every spring.
    static let plain = Animation.easeOut(duration: 0.15)

    /// Hover, press (scale 0.97), toggles.
    static func snap(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.20, dampingFraction: 0.70)
    }

    /// Tab change, page push, row expand.
    static func settle(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.30, dampingFraction: 0.82)
    }

    /// The panel, the bubble and the strip appearing.
    static func open(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.46, dampingFraction: 0.74)
    }

    /// Anything leaving: a quick ease-out curve, never a spring.
    static func close(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .timingCurve(0.45, 0, 0.2, 1, duration: 0.26)
    }

    /// Wisp's light easing between brightness levels when the state changes (Coucou's glow timing).
    static func glow(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .easeInOut(duration: 0.4)
    }

    /// The light breathing while listening or thinking: one half-breath; repeat it with autoreverse. Nil with
    /// Reduce Motion: the glow holds still.
    static func breathe(_ reduceMotion: Bool, slow: Bool = false) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: slow ? 1.8 : 1.2)
    }

    /// Content hand-off between tabs and pages: the old content leaves first, then the new one settles in.
    static func handOffOut(_ reduceMotion: Bool) -> Animation { reduceMotion ? plain : .easeIn(duration: 0.14) }
    static func handOffIn(_ reduceMotion: Bool) -> Animation { reduceMotion ? plain : settle(false).delay(0.12) }

    /// A list arriving row by row: 30 ms apart, the eighth row and later together. None with Reduce Motion.
    static func cascadeDelay(row: Int, _ reduceMotion: Bool) -> Double {
        reduceMotion ? 0 : Double(min(max(row, 0), 8)) * 0.03
    }
}
