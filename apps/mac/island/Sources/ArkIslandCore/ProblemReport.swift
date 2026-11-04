import Foundation

// Report a problem (2026-11-04, idea from atticus-mac "report feedback"). One click opens a new GitHub issue with the ARK version and the
// macOS version filled in. Nothing else is added: no log, no chat, no memory. The user writes the rest and sends it, or closes the page.

public enum ProblemReport {
    public static let repository = "https://github.com/Keshab-Shrestha/Atom-Your_Pal"

    public static func url(arkVersion: String, macOS: String) -> URL? {
        var parts = URLComponents(string: repository + "/issues/new")
        let body = "**What happened**\n\n\n**What I expected**\n\n\n---\nARK \(arkVersion) · macOS \(macOS)\n(No logs or chats are attached. Add them only if you want to.)\n"
        parts?.queryItems = [URLQueryItem(name: "title", value: ""), URLQueryItem(name: "body", value: body)]
        return parts?.url
    }
}
