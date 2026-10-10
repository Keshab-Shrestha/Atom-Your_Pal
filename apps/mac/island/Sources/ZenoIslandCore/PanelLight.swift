/// How brightly Wisp's light falls across the top of the panel for each state (ADR-084, design study §3 A):
/// one hue, many brightnesses. Dim at rest, brighter and breathing while listening, a slower breath while
/// thinking, brightest while speaking. The theme's glow colour and strength are applied by the view.
public struct PanelLight: Sendable, Equatable {
    public enum Breath: Sendable, Equatable { case still, normal, slow }

    /// Peak opacity of the glow, 0...1.
    public var brightness: Double
    public var breath: Breath

    public init(_ kind: IslandStatus.Kind) {
        switch kind {
        case .starting, .ready: (brightness, breath) = (0.15, .still)
        case .listening: (brightness, breath) = (0.30, .normal)
        case .transcribing, .thinking: (brightness, breath) = (0.24, .slow)
        case .speaking: (brightness, breath) = (0.42, .still)
        case .acting: (brightness, breath) = (0.30, .still)
        // Waiting on the user: the light holds at the thinking level; the amber is elsewhere (bubble, strip).
        case .asking: (brightness, breath) = (0.24, .still)
        case .notice: (brightness, breath) = (0.18, .still)
        // Something went wrong: the light dims; Wisp's worried face says the rest.
        case .problem: (brightness, breath) = (0.10, .still)
        }
    }
}
