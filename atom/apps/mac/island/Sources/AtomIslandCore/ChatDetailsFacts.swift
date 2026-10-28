import Foundation

/// What the chat Details surface says about a saved chat, worked out from its inspection (the HTML preview's Details pane).
/// The numbers are the runtime's own replay estimate, not a provider token meter.
public struct ChatDetailsFacts: Equatable, Sendable {
    public struct Row: Equatable, Sendable {
        public let title: String
        public let value: String
    }

    public let messagesText: String
    /// The replay estimate as a share of its budget, 0...1.
    public let contextFraction: Double
    /// "25%", "<1%" for a tiny share, "0%" for none.
    public let percentText: String
    public let contextText: String
    public let omittedText: String?
    public let accessRows: [Row]

    public init(info: ChatControlResponse.Info) {
        messagesText = info.messages == 1 ? "1 message saved" : "\(info.messages) messages saved"
        let used = max(0, info.replayBytes)
        contextFraction = info.replayBudget > 0 ? min(1, Double(used) / Double(info.replayBudget)) : 1
        let percent = Int((contextFraction * 100).rounded())
        percentText = used == 0 ? "0%" : percent == 0 ? "<1%" : "\(percent)%"
        contextText = "\(Self.kilobytes(used)) of \(Self.kilobytes(info.replayBudget))"
        omittedText = info.omitted > 0
            ? "\(info.omitted) earlier message\(info.omitted == 1 ? "" : "s") left out of the replay. The archive stays intact." : nil
        accessRows = info.access.map { access in
            [
                Row(title: "ATOM tools", value: access.hostTools ? "On" : "Off"),
                Row(title: "Project files", value: access.project ? "On" : "Off"),
                Row(title: "File permissions", value: access.fileGrants > 0 ? "\(access.fileGrants) for this chat" : "None"),
                Row(title: "Computer control", value: access.computer ? "On" : "Off"),
                Row(title: "Web", value: access.web ? "On" : "Off"),
            ]
        } ?? []
    }

    /// 1.0 KB, 120.0 KB: the same figure the chat menu shows.
    private static func kilobytes(_ value: Int) -> String { String(format: "%.1f KB", Double(max(0, value)) / 1000) }
}
