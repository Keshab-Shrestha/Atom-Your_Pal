import Foundation

/// User-maintained background data. Never a permission or a generated conversation summary.
public struct ChatBrief: Codable, Sendable, Equatable {
    public let text: String
    public let version: Int
    public static func valid(_ text: String) -> Bool {
        !text.unicodeScalars.contains {
            let n = $0.value
            return (n < 32 && n != 9 && n != 10 && n != 13) || (127...159).contains(n)
                || (0x200B...0x200F).contains(n) || (0x202A...0x202E).contains(n)
                || (0x2060...0x206F).contains(n) || n == 0xFEFF
        }
    }
    public init(text: String, version: Int) { self.text = text; self.version = version }
    private enum CodingKeys: String, CodingKey { case text, version }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decode(String.self, forKey: .text)
        version = try c.decode(Int.self, forKey: .version)
        guard Self.valid(text), (0...2_000_000_000).contains(version) else {
            throw DecodingError.dataCorruptedError(forKey: .text, in: c, debugDescription: "Invalid chat brief")
        }
    }
}
