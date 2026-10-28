/// Pal's behaviour (ADR-042), kept free of AppKit and the clock so every rule is unit-tested:
/// the window calls `update(status:at:)` when ATOM's state changes and `step(to:)` once per frame.
///
/// - Idle: floats to a random spot along the bottom of the screen, rests there a few seconds, floats on.
/// - No activity for `napAfter`: stops and naps until ATOM is used again.
/// - Listening, thinking, speaking: stops where it is and reacts.
/// - Problem: stops and looks worried until the problem clears.
/// - Picked up by the user: dangles in their hand. Put down on the Dock walkway it wanders again; put down
///   anywhere else it is "parked": it stays exactly there (resting, napping, reacting) until sent home.
public struct PetBrain: Sendable {
    public enum Mood: Sendable, Equatable {
        case floating, resting, napping, listening, thinking, speaking, worried, carried

        /// Moods that hold Pal still: a ATOM turn, a problem, or being carried.
        public var isReacting: Bool {
            switch self {
            case .listening, .thinking, .speaking, .worried, .carried: true
            default: false
            }
        }
    }

    public struct Tuning: Sendable, Equatable {
        /// Points per second while floating.
        public var speed: Double = 38
        /// How long a rest between floats lasts, in seconds.
        public var restSeconds: ClosedRange<Double> = 2.5...7
        /// Seconds with no ATOM activity before Pal naps.
        public var napAfter: Double = 180
        /// The shortest float: closer targets are skipped, so Pal never shuffles in place.
        public var minimumTrip: Double = 60
        /// False: Pal rests where it is instead of floating along the Dock.
        public var wanders = true

        public init() {}
    }

    public private(set) var mood = Mood.resting
    /// Parked by the user somewhere other than the Dock walkway: never wanders. `x` is not used while parked.
    public private(set) var pinned = false
    /// Centre of Pal along the walkway, 0...width.
    public private(set) var x: Double
    /// +1 facing right, -1 facing left.
    public private(set) var facing: Double = 1
    /// Changes take effect on the next step (the settings can change while Pal runs).
    public var tuning: Tuning

    private var width: Double
    private var target: Double?
    /// The mood ATOM's current state asks for, shown again when Pal is put down.
    private var statusMood: Mood?
    private var restUntil: Double
    private var lastActivity: Double
    private var lastStep: Double
    private var random: SeededRandom

    /// - Parameters:
    ///   - width: the walkway's length in points (the screen's width minus margins).
    ///   - now: the current time in seconds (any monotonic clock).
    ///   - seed: makes the wandering repeatable in tests.
    public init(width: Double, now: Double, tuning: Tuning = Tuning(), seed: UInt64 = 0x5EED_715) {
        self.tuning = tuning
        self.width = max(width, 0)
        random = SeededRandom(seed: seed)
        x = self.width * 0.8
        lastActivity = now
        lastStep = now
        restUntil = now + tuning.restSeconds.lowerBound
    }

    /// The walkway changed size (screen resolution or Dock changed): keep Pal on it.
    public mutating func resize(width: Double) {
        self.width = max(width, 0)
        x = min(max(x, 0), self.width)
        if let t = target { target = min(max(t, 0), self.width) }
    }

    /// The mood a ATOM state asks for; nil for idle states (Pal keeps wandering, resting or napping). Also the
    /// panel header's Pal (ADR-084), which shows `.resting` for nil.
    public static func mood(for status: IslandStatus.Kind) -> Mood? {
        switch status {
        case .listening: .listening
        case .transcribing, .thinking, .acting, .asking: .thinking
        case .speaking: .speaking
        case .problem: .worried
        case .starting, .ready, .notice: nil
        }
    }

    /// ATOM's state changed.
    public mutating func update(status: IslandStatus.Kind, at now: Double) {
        let reaction = Self.mood(for: status)
        statusMood = reaction
        if mood == .carried { // in the user's hand: the reaction shows once put down
            lastActivity = now
            return
        }
        if let reaction {
            mood = reaction
            target = nil
            lastActivity = now
            return
        }
        // Back to idle: rest a moment, then wander. Leaving a nap only happens through activity.
        if mood.isReacting {
            lastActivity = now
            rest(at: now)
        }
    }

    /// The user picked Pal up.
    public mutating func grab(at now: Double) {
        mood = .carried
        target = nil
        lastActivity = now
    }

    /// The user put Pal down. `homeX` is its place on the Dock walkway if it was put down there (it wanders
    /// from that spot); nil if it was put down anywhere else (it stays parked).
    public mutating func drop(homeX: Double?, at now: Double) {
        lastActivity = now
        pinned = homeX == nil
        if let homeX { x = min(max(homeX, 0), width) }
        if let statusMood {
            mood = statusMood
        } else {
            rest(at: now)
        }
    }

    /// Send a parked Pal back to wandering the Dock walkway (it starts from wherever `x` is).
    public mutating func goHome(at now: Double) {
        pinned = false
        poke(at: now)
        if mood == .resting { rest(at: now) }
    }

    /// Something happened that should wake Pal (a shortcut, opening the island) without a state change.
    public mutating func poke(at now: Double) {
        lastActivity = now
        if mood == .napping { rest(at: now) }
    }

    /// Advances to `now` and returns the mood to draw. Call once per frame.
    @discardableResult
    public mutating func step(to now: Double) -> Mood {
        let dt = max(0, min(now - lastStep, 0.25)) // a stalled frame never teleports Pal
        lastStep = now
        if mood.isReacting || mood == .napping { return mood }

        if now - lastActivity >= tuning.napAfter {
            mood = .napping
            target = nil
            return mood
        }

        switch mood {
        case .resting where (pinned || !tuning.wanders) && now >= restUntil:
            restUntil = now + tuning.restSeconds.lowerBound // parked: rests where it is
        case .resting where now >= restUntil:
            target = pickTarget()
            mood = target == nil ? .resting : .floating
            if target == nil { restUntil = now + tuning.restSeconds.lowerBound }
        case .floating:
            guard let goal = target else { rest(at: now); break }
            let distance = goal - x
            let travel = tuning.speed * dt
            if abs(distance) <= travel {
                x = goal
                rest(at: now)
            } else {
                facing = distance > 0 ? 1 : -1
                x += facing * travel
            }
        default:
            break
        }
        return mood
    }

    // MARK: - Private

    private mutating func rest(at now: Double) {
        mood = .resting
        target = nil
        let range = tuning.restSeconds
        restUntil = now + range.lowerBound + random.unit() * (range.upperBound - range.lowerBound)
    }

    /// A spot at least `minimumTrip` away, or nil if the walkway is too short to go anywhere.
    private mutating func pickTarget() -> Double? {
        guard width > tuning.minimumTrip else { return nil }
        for _ in 0..<8 {
            let candidate = random.unit() * width
            if abs(candidate - x) >= tuning.minimumTrip { return candidate }
        }
        // Unlucky draws: go to whichever end is farther.
        return x < width / 2 ? width : 0
    }
}

/// A small repeatable random source (SplitMix64), so wandering can be tested exactly.
struct SeededRandom: Sendable {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// A value in 0..<1.
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}

/// What a press on Pal does with the ATOM window (ADR-051, ADR-089, ADR-093): opens it, or closes it when it is open
/// and in front, like the menu-bar icon. A double-click always ends with it open, so its second press never closes
/// what the first opened.
public enum PetClickAction: Sendable, Equatable {
    case open, close, none

    public static func forPress(clickCount: Int, windowOpen: Bool) -> PetClickAction {
        if !windowOpen { return .open }
        return clickCount >= 2 ? .none : .close
    }
}
