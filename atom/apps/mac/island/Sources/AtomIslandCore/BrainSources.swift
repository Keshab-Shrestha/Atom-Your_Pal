import Foundation

public struct BrainNoteSource: Codable, Sendable, Equatable {
    public var path: String
    public var relativePath: String
    public var checkedAt: String
    public var state: String
}
public struct BrainSourceFolder: Codable, Sendable, Equatable {
    public var id: String
    public var path: String
    public var identity: String
    public var checkedAt: String
    public var skipped: Int
    public var documents: Bool?
}
public struct BrainSourceSummary: Codable, Sendable, Equatable {
    public var folder: BrainSourceFolder?
    public var notes: Int
    public var corrected: Int
    public var conflicts: Int
    public var missing: Int
    public var excluded: Int
    public init() { notes = 0; corrected = 0; conflicts = 0; missing = 0; excluded = 0 }
}
public struct BrainSourcePreview: Codable, Sendable, Equatable {
    public var token: String
    public var path: String
    public var files: [String]
    public var count: Int
    public var skipped: Int
}
public struct BrainSourceResponse: Codable, Sendable, Equatable {
    public var request: String
    public var state: BrainSourceSummary
    public var preview: BrainSourcePreview?
    public var error: String?
}
