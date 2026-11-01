import Foundation

/// Splits a byte stream into lines. Bytes arrive in arbitrary chunks, so a line (or a multi-byte
/// character) can be split across chunks.
public struct LineBuffer: Sendable {
    /// Longest line kept. A longer one is a runtime bug; it is dropped instead of growing memory without bound.
    public let maxLineBytes: Int
    private var pending = Data()
    private var discarding = false

    public init(maxLineBytes: Int = 1 << 20) {
        self.maxLineBytes = maxLineBytes
    }

    public enum Item: Equatable, Sendable {
        case line(String)
        /// A line was longer than `maxLineBytes` and was dropped.
        case overlong
    }

    /// Adds a chunk and returns the complete lines it finished, without their line endings.
    public mutating func append(_ chunk: Data) -> [Item] {
        var items: [Item] = []
        var rest = chunk[...]
        while let newline = rest.firstIndex(of: 0x0A) {
            let piece = rest[rest.startIndex..<newline]
            rest = rest[rest.index(after: newline)...]
            if discarding {
                discarding = false
                pending.removeAll()
                continue
            }
            pending.append(contentsOf: piece)
            if pending.count > maxLineBytes {
                items.append(.overlong)
            } else {
                items.append(.line(Self.text(pending)))
            }
            pending.removeAll()
        }
        if !discarding {
            pending.append(contentsOf: rest)
            if pending.count > maxLineBytes {
                pending.removeAll()
                discarding = true
                items.append(.overlong)
            }
        }
        return items
    }

    /// The unterminated text left at end of stream, if any.
    public mutating func finish() -> [Item] {
        defer { pending.removeAll(); discarding = false }
        guard !discarding, !pending.isEmpty else { return [] }
        return [.line(Self.text(pending))]
    }

    private static func text(_ data: Data) -> String {
        var s = String(decoding: data, as: UTF8.self)
        if s.hasSuffix("\r") { s.removeLast() }
        return s
    }
}
