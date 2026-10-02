/// The one-line status shown in the pill, derived from the runtime's status and events.
/// Task 0.5.4 shows only this placeholder line; Task 0.5.6 adds the live level and timings.
public struct IslandStatus: Sendable, Equatable {
    public enum Tone: Sendable, Equatable {
        /// Starting or restarting.
        case waiting
        /// Ready for a question.
        case ready
        /// Listening, transcribing, thinking or speaking.
        case busy
        /// Something needs attention.
        case problem
    }

    public private(set) var label = "Starting…"
    public private(set) var tone = Tone.waiting

    public init() {}

    public mutating func apply(_ status: RuntimeSupervisor.Status) {
        switch status {
        case .stopped: set("Stopped", .problem)
        case .running: set("Starting…", .waiting)
        case .restarting: set("Restarting…", .waiting)
        case .configError: set("Check settings", .problem)
        case .failed: set("Stopped", .problem)
        }
    }

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .ready: set("Ready", .ready)
        case .state(let state):
            switch state {
            case .idle: set("Ready", .ready)
            case .listening: set("Listening", .busy)
            case .transcribing: set("Transcribing", .busy)
            case .thinking: set("Thinking", .busy)
            case .speaking: set("Speaking", .busy)
            }
        case .error: set("Something went wrong", .problem)
        default: break
        }
    }

    private mutating func set(_ label: String, _ tone: Tone) {
        self.label = label
        self.tone = tone
    }
}
