import Foundation

/// ADR-269: an AI program ARK looked for on this Mac. `status` is "ready", "found" or "local-model".
public struct AiProgram: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var found: Bool
    public var version: String?
    /// Display only ("~" is the home folder).
    public var path: String?
    public var status: String
    public var signedIn: Bool?
    public var provider: String?
    public var allowed: Bool
    public var note: String?

    public init(id: String, name: String, found: Bool, version: String? = nil, path: String? = nil, status: String,
                signedIn: Bool? = nil, provider: String? = nil, allowed: Bool = false, note: String? = nil) {
        self.id = id; self.name = name; self.found = found; self.version = version; self.path = path; self.status = status
        self.signedIn = signedIn; self.provider = provider; self.allowed = allowed; self.note = note
    }
}

/// ADR-269: the last scan. The runtime sends it at start, after a change, and when asked.
public struct AiProgramsState: Sendable, Equatable {
    public var programs: [AiProgram]
    public var scannedAt: Date?

    public init(programs: [AiProgram], scannedAt: Date? = nil) {
        self.programs = programs
        self.scannedAt = scannedAt
    }

    /// A malformed entry is left out.
    static func from(_ values: [String: Any]) -> AiProgramsState {
        let programs = (values["programs"] as? [Any] ?? []).compactMap { entry -> AiProgram? in
            guard let m = entry as? [String: Any], let id = m["id"] as? String, let name = m["name"] as? String, let status = m["status"] as? String else { return nil }
            let flag = { (key: String) in (m[key] as? NSNumber).map(\.boolValue) }
            return AiProgram(id: id, name: name, found: flag("found") ?? false, version: m["version"] as? String, path: m["path"] as? String, status: status,
                             signedIn: flag("signedIn"), provider: m["provider"] as? String, allowed: flag("allowed") ?? false, note: m["note"] as? String)
        }
        let at = (values["scannedAt"] as? String).flatMap { s -> Date? in
            let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fractional.date(from: s) ?? ISO8601DateFormatter().date(from: s)
        }
        return AiProgramsState(programs: programs, scannedAt: at)
    }
}
