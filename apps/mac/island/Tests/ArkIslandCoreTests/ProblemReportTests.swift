import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Problem report")
struct ProblemReportTests {
    @Test("the issue page carries only the versions")
    func versionsOnly() throws {
        let url = try #require(ProblemReport.url(arkVersion: "1.2", macOS: "14.5"))
        #expect(url.absoluteString.hasPrefix("https://github.com/Keshab-Shrestha/Atom-Your_Pal/issues/new?"))
        let body = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "body" }?.value)
        #expect(body.contains("ARK 1.2 · macOS 14.5"))
        #expect(body.contains("No logs or chats are attached"))
    }
}
