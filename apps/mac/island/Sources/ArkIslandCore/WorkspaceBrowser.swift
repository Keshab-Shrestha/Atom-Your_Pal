import Foundation

/// The native, user-operated browser accepts web addresses only. It has no host-tool bridge.
public enum WorkspaceBrowserAddress {
    public static let refusal = "Use HTTPS, or HTTP for localhost, without embedded credentials."
    public static func allows(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil else { return false }
        let local = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
        guard parts.scheme?.lowercased() == "https" || local else { return false }
        return !url.absoluteString.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    public static func resolve(_ input: String) -> URL? {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, !raw.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }) else { return nil }
        let explicit = raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://")
        let local = raw.range(of: #"^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)"#, options: .regularExpression) != nil
        // A domain may omit its scheme; arbitrary schemes (including file/data/javascript) never become web addresses.
        if !explicit, !local, raw.contains(":") || raw.hasPrefix("/") { return nil }
        guard let url = URL(string: explicit ? raw : (local ? "http://" : "https://") + raw), allows(url) else { return nil }
        return url
    }
}
