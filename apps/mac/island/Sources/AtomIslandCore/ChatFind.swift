import Foundation

/// ADR-152: literal search of already loaded source text, independent of archived/global search.
public enum ChatFind {
    public struct Match: Sendable, Equatable, Identifiable {
        public let turnID: Int
        public let user: Bool
        public let offset: Int
        public let before: String
        public let found: String
        public let after: String
        public var id: String { "\(turnID)-\(user)-\(offset)" }
    }

    public struct Results: Sendable, Equatable {
        public var matches: [Match] = []
        public var more = false
        public init() {}
        public func selected(_ index: Int) -> Match? {
            matches.isEmpty ? nil : matches[min(max(0, index), matches.count - 1)]
        }
    }

    public static func search(_ turns: [Conversation.Turn], query: String) -> Results {
        guard !query.isEmpty, query.count <= 128 else { return Results() }
        var result = Results()
        for turn in turns {
            for (user, source) in [(true, turn.transcript), (false, turn.reply ?? "")] {
                var start = source.startIndex
                while start < source.endIndex,
                      let range = source.range(of: query, options: [.caseInsensitive], range: start..<source.endIndex),
                      range.lowerBound < range.upperBound {
                    guard result.matches.count < 500 else { result.more = true; return result }
                    result.matches.append(Match(turnID: turn.id, user: user,
                        offset: source.utf16.distance(from: source.utf16.startIndex, to: range.lowerBound),
                        before: String(source[..<range.lowerBound].suffix(40)), found: String(source[range]),
                        after: String(source[range.upperBound...].prefix(60))))
                    start = range.upperBound
                }
            }
        }
        return result
    }
}
