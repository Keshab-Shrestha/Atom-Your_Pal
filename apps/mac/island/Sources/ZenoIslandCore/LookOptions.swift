import CoreGraphics

/// A setting that is one of a few named choices, drawn as a row of chips (ADR-052).
public protocol SettingsChoice: CaseIterable, Hashable, Sendable {
    var title: String { get }
}

extension DictationMode: SettingsChoice {}

/// How big Pal is drawn, in points (the original size is 56).
public enum PalSize: Int, SettingsChoice {
    case small = 44, medium = 56, large = 72, huge = 92

    public var points: CGFloat { CGFloat(rawValue) }
    /// Relative to the original size: things placed around Pal (the bubble's gap) scale with it.
    public var scale: CGFloat { points / 56 }
    public var title: String {
        switch self {
        case .small: "Small"
        case .medium: "Medium"
        case .large: "Large"
        case .huge: "Huge"
        }
    }
}

/// How much Pal floats about when idle.
public enum PalWander: Int, SettingsChoice {
    case stayPut = 0, calm, normal, lively

    /// Points per second.
    public var speed: Double {
        switch self {
        case .stayPut: 38
        case .calm: 22
        case .normal: 38
        case .lively: 64
        }
    }
    public var wanders: Bool { self != .stayPut }
    public var title: String {
        switch self {
        case .stayPut: "Stay put"
        case .calm: "Calm"
        case .normal: "Normal"
        case .lively: "Lively"
        }
    }
}

/// How long with no activity before Pal falls asleep.
public enum PalNap: Int, SettingsChoice {
    case never = 0
    case minute1 = 60
    case minutes3 = 180
    case minutes10 = 600

    public var seconds: Double { self == .never ? .infinity : Double(rawValue) }
    public var title: String {
        switch self {
        case .never: "Never"
        case .minute1: "1 min"
        case .minutes3: "3 min"
        case .minutes10: "10 min"
        }
    }
}

extension PetBrain.Tuning {
    /// Pal's pace and sleepiness from the settings.
    public init(wander: PalWander, nap: PalNap) {
        self.init()
        speed = wander.speed
        wanders = wander.wanders
        napAfter = nap.seconds
    }
}

/// How long the speech bubble stays after a dictation or a turn ends.
public enum BubbleStay: Int, SettingsChoice {
    case seconds1 = 1, seconds2 = 2, seconds4 = 4, seconds8 = 8

    public var seconds: Double { Double(rawValue) }
    public var title: String { "\(rawValue) s" }
}

public enum BubbleSize: Int, SettingsChoice {
    case small = 0, normal, large

    public var scale: CGFloat {
        switch self {
        case .small: 0.86
        case .normal: 1
        case .large: 1.2
        }
    }
    public var title: String {
        switch self {
        case .small: "Small"
        case .normal: "Medium"
        case .large: "Large"
        }
    }
}

/// How see-through the speech bubble is.
public enum BubbleOpacity: Int, SettingsChoice {
    case clear = 0, normal, solid

    /// The dark layer's opacity over the blur.
    public var fill: Double {
        switch self {
        case .clear: 0.38
        case .normal: 0.66
        case .solid: 0.94
        }
    }
    public var title: String {
        switch self {
        case .clear: "Clear"
        case .normal: "Normal"
        case .solid: "Solid"
        }
    }
}
