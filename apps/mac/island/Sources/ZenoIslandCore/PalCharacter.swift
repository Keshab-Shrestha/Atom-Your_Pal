import Foundation

// ADR-089: a pal's character, read from an avatar-definition file (assets/pals/<id>.json, schema 1): its body (a
// rounded box with nodes such as ears, arms and feet), colours, expressions and animations. Pure: the app draws it.

public struct PalDefinition: Sendable, Equatable, Decodable {
    public var name: String
    public var body: Body
    public var colors: Colors
    public var expressions: [String: Expression]
    public var animations: [String: Animation]

    public struct Body: Sendable, Equatable, Decodable {
        public var primary: Surface
        public var nodes: [Node]
    }

    public struct Surface: Sendable, Equatable, Decodable {
        /// "cube", "cone", "capsule" (anything else is drawn as a capsule).
        public var type: String
        public var width: Double
        public var height: Double
        public var depth: Double
        public var roundness: Double?
        public var morphRoundness: Double?
        public var tipRoundness: Double?
        public var baseRoundness: Double?
    }

    public struct Node: Sendable, Equatable, Decodable {
        public var surface: Surface
        /// x, y (up), z (toward the viewer), from the body's centre.
        public var position: [Double]
        /// Degrees about x, y and z.
        public var rotation: [Double]
    }

    public struct Colors: Sendable, Equatable, Decodable {
        public var body: String?
        public var eyes: String?
    }

    public struct Eye: Sendable, Equatable, Decodable {
        public var width: Double
        public var height: Double
        public var x: Double
        /// Down is positive, on the face.
        public var y: Double
        /// Degrees, counter-clockwise.
        public var angle: Double
    }

    public struct Expression: Sendable, Equatable, Decodable {
        public struct Head: Sendable, Equatable, Decodable {
            public var x: Double, y: Double, z: Double
        }
        public struct Eyes: Sendable, Equatable, Decodable {
            public var left: Eye
            public var right: Eye
            public var spacing: Double
        }
        public struct Motion: Sendable, Equatable, Decodable {
            public var eyes: String?
            public var body: String?
        }
        public var head: Head
        public var eyes: Eyes
        public var motion: Motion?
        public var colors: Colors?
    }

    public struct Animation: Sendable, Equatable, Decodable {
        public struct Step: Sendable, Equatable, Decodable {
            public var expression: String
            public var holdMs: Double
            public var transitionMs: Double
        }
        public struct Blink: Sendable, Equatable, Decodable {
            public var enabled: Bool
            public var initialDelayMs: Double
            public var minIntervalMs: Double
            public var maxIntervalMs: Double
            public var durationMs: Double
        }
        public var steps: [Step]
        public var blink: Blink?
    }

    public static func decode(_ data: Data) throws -> PalDefinition {
        try JSONDecoder().decode(PalDefinition.self, from: data)
    }

    /// The same character in other colours (an agent Keshab added gets Pal's shape in its own colours).
    public func recolored(body: String, eyes: String) -> PalDefinition {
        var copy = self
        copy.colors = Colors(body: body, eyes: eyes)
        return copy
    }
}

/// An RGB colour, 0...1.
public struct PalRGB: Sendable, Equatable {
    public var r: Double, g: Double, b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// "#rrggbb"; anything else is nil.
    public init?(hex: String?) {
        guard let hex, hex.hasPrefix("#"), hex.count == 7, let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(r: Double((v >> 16) & 0xFF) / 255, g: Double((v >> 8) & 0xFF) / 255, b: Double(v & 0xFF) / 255)
    }

    public func mix(_ other: PalRGB, _ t: Double) -> PalRGB {
        PalRGB(r: r + (other.r - r) * t, g: g + (other.g - g) * t, b: b + (other.b - b) * t)
    }
}

/// Everything that moves, at one moment: the head's turn, both eyes, the colours, the motion and the blink.
public struct PalPose: Sendable, Equatable {
    /// Degrees: x nods, y turns, z tilts.
    public var headX: Double
    public var headY: Double
    public var headZ: Double
    public var left: PalDefinition.Eye
    public var right: PalDefinition.Eye
    public var spacing: Double
    public var body: PalRGB
    public var eyes: PalRGB
    public var bodyMotion: String
    public var eyeMotion: String
    /// 0 open, 1 shut.
    public var blink: Double

    /// One expression, still.
    public static func of(_ e: PalDefinition.Expression, in d: PalDefinition) -> PalPose {
        PalPose(headX: e.head.x, headY: e.head.y, headZ: e.head.z, left: e.eyes.left, right: e.eyes.right, spacing: e.eyes.spacing,
                body: PalRGB(hex: e.colors?.body) ?? PalRGB(hex: d.colors.body) ?? PalRGB(r: 0.96, g: 0.96, b: 0.96),
                eyes: PalRGB(hex: e.colors?.eyes) ?? PalRGB(hex: d.colors.eyes) ?? PalRGB(r: 0.27, g: 0.47, b: 0.77),
                bodyMotion: e.motion?.body ?? "none", eyeMotion: e.motion?.eyes ?? "none", blink: 0)
    }

    func mix(_ o: PalPose, _ t: Double) -> PalPose {
        func m(_ a: Double, _ b: Double) -> Double { a + (b - a) * t }
        func eye(_ a: PalDefinition.Eye, _ b: PalDefinition.Eye) -> PalDefinition.Eye {
            PalDefinition.Eye(width: m(a.width, b.width), height: m(a.height, b.height), x: m(a.x, b.x), y: m(a.y, b.y), angle: m(a.angle, b.angle))
        }
        return PalPose(headX: m(headX, o.headX), headY: m(headY, o.headY), headZ: m(headZ, o.headZ), left: eye(left, o.left), right: eye(right, o.right),
                       spacing: m(spacing, o.spacing), body: body.mix(o.body, t), eyes: eyes.mix(o.eyes, t),
                       bodyMotion: t < 0.5 ? bodyMotion : o.bodyMotion, eyeMotion: t < 0.5 ? eyeMotion : o.eyeMotion, blink: m(blink, o.blink))
    }

    /// The pose of `animation` at `time` seconds: its steps loop, each easing in from the one before over its
    /// transition and then holding; blinks come at pseudo-random intervals the definition allows (the same at the
    /// same time, so the gallery is repeatable). An unknown animation holds the neutral (or first) expression.
    public static func at(_ d: PalDefinition, animation name: String, time: Double) -> PalPose {
        guard let fallback = d.expressions["neutral"] ?? d.expressions.values.first else {
            return PalPose(headX: 0, headY: 0, headZ: 0, left: Self.plainEye, right: Self.plainEye, spacing: 70,
                           body: PalRGB(hex: d.colors.body) ?? PalRGB(r: 0.96, g: 0.96, b: 0.96), eyes: PalRGB(hex: d.colors.eyes) ?? PalRGB(r: 0.27, g: 0.47, b: 0.77),
                           bodyMotion: "none", eyeMotion: "none", blink: 0)
        }
        guard let animation = d.animations[name], !animation.steps.isEmpty else { return of(fallback, in: d) }
        let steps = animation.steps
        let pose = { (i: Int) in of(d.expressions[steps[(i + steps.count) % steps.count].expression] ?? fallback, in: d) }
        let total = steps.reduce(0) { $0 + max(1, $1.transitionMs + $1.holdMs) }
        var t = (time * 1000).truncatingRemainder(dividingBy: total)
        if t < 0 { t += total }
        var result = pose(0)
        for (i, step) in steps.enumerated() {
            let length = max(1, step.transitionMs + step.holdMs)
            if t < length {
                if t < step.transitionMs {
                    let x = t / max(1, step.transitionMs)
                    result = pose(i - 1).mix(pose(i), x * x * (3 - 2 * x)) // smooth
                } else {
                    result = pose(i)
                }
                break
            }
            t -= length
        }
        if let blink = animation.blink, blink.enabled { result.blink = Self.blink(blink, time: time) }
        return result
    }

    static let plainEye = PalDefinition.Eye(width: 30, height: 40, x: 0, y: 0, angle: 0)

    /// 0...1 shut, for a blink schedule that repeats every 16 blinks.
    static func blink(_ b: PalDefinition.Animation.Blink, time: Double) -> Double {
        let ms = time * 1000 - b.initialDelayMs
        guard ms >= 0 else { return 0 }
        let intervals = (0..<16).map { i -> Double in
            let h = sin(Double(i) * 12.9898 + 78.233) * 43758.5453
            return b.minIntervalMs + (b.maxIntervalMs - b.minIntervalMs) * (h - floor(h))
        }
        var t = ms.truncatingRemainder(dividingBy: intervals.reduce(0, +))
        for interval in intervals {
            if t < b.durationMs { return sin(.pi * t / b.durationMs) }
            if t < interval { return 0 }
            t -= interval
        }
        return 0
    }
}

/// Which animation each moment plays.
public enum PalAnimation {
    public static func name(mood: PetBrain.Mood, reaction: PalReaction?) -> String {
        switch reaction {
        case .hello?: return "celebrate"
        case .dizzy?: return "confused"
        case .squish?: return "surprised"
        case .yawn?: return "drowsy"
        case nil: break
        }
        switch mood {
        case .floating, .resting: return "idle"
        case .napping: return "sleeping"
        case .listening: return "listening"
        case .thinking: return "thinking"
        case .speaking: return "happy"
        case .worried: return "confused"
        case .carried: return "surprised"
        }
    }

    /// A worker: busy, or at rest.
    public static func worker(running: Bool) -> String { running ? "working" : "idle" }

    /// Colours for an agent Keshab added, chosen by its id so it keeps them.
    public static let agentColors: [(body: String, eyes: String)] = [
        ("#c9e4f5", "#24527a"), ("#f5d6c9", "#7a3a24"), ("#d6f5c9", "#2f6a24"), ("#efd2f5", "#5e2a7a"),
        ("#f5efc9", "#6a5a14"), ("#c9f5ec", "#1f6358"), ("#f5c9d6", "#7a2440"), ("#dcd8f2", "#3d3480"),
    ]

    public static func agentColor(for id: String) -> (body: String, eyes: String) {
        let sum = id.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        return agentColors[sum % agentColors.count]
    }
}
