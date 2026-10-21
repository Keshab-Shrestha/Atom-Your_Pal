import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Workspace browser addresses")
struct WorkspaceBrowserTests {
    @Test func userAddressesResolveWithoutEnablingNonWebSchemesOrCredentials() {
        #expect(WorkspaceBrowserAddress.resolve(" example.com/docs ")?.absoluteString == "https://example.com/docs")
        #expect(WorkspaceBrowserAddress.resolve("localhost:3000/path")?.absoluteString == "http://localhost:3000/path")
        #expect(WorkspaceBrowserAddress.resolve("127.0.0.1:4311")?.host == "127.0.0.1")
        #expect(WorkspaceBrowserAddress.resolve("[::1]:4311/path")?.scheme == "http")
        #expect(WorkspaceBrowserAddress.resolve("https://example.com/?q=cedar#notes") != nil)
        for address in ["", "http://example.com", "file:///Users/person/secret.txt", "javascript:alert(1)", "data:text/html,test", "mailto:a@example.com", "atom://tool", "https://name:password@example.com", "https://user@example.com", "https://", "/etc/passwd", "https://example.com/with space", "https://example.com/\nfoo"] {
            #expect(WorkspaceBrowserAddress.resolve(address) == nil, "Refuse \(address)")
        }
    }
    @Test func redirectsAndChildFramesMustAlsoUseWebURLs() {
        for address in ["file:///tmp/page.html", "data:text/html,test", "about:blank", "https://user:secret@example.com", "custom-app://open"] {
            #expect(!WorkspaceBrowserAddress.allows(URL(string: address)!))
        }
        #expect(WorkspaceBrowserAddress.allows(URL(string: "http://localhost:4311/second")!))
    }
    @MainActor @Test func browserSelectionPersistsButDoesNotCarryFileResultsAcrossScopes() {
        let suite = "atom.tests.browser.\(UUID().uuidString)"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = IslandSettings(defaults: defaults); settings.workspaceSurface = "browser"
        #expect(IslandSettings(defaults: defaults).workspaceSurface == "browser")
        var workspace = ProjectWorkspaceState()
        let selected = workspace.select(.browser); #expect(selected); #expect(workspace.tab == "browser")
        workspace.clear(); #expect(workspace.response == nil); #expect(workspace.pending == nil)
        #expect(WorkspaceSurface.allCases.map(\.rawValue) == ["files", "changes", "git", "browser", "terminal"])
    }
}
