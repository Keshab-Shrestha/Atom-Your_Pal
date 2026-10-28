import AppKit
import SwiftUI
import AtomIslandCore

/// Other tools reaching ATOM: the local API for Hermes, Claude Code and scripts on this Mac.
struct ConnectionsSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    /// ADR-098 item 5: what "Copy token" did ("Copied", or why not). Never the token.
    @State private var tokenNote: String?
    /// "Regenerate" asks first: tools that hold the old token stop working.
    @State private var askingRegenerate = false

    var body: some View {
        let settings = model.settings
        // ADR-098 item 5: the local API for Hermes, Claude Code and other tools on this Mac. The token is never shown:
        // "Copy token" reads data/api-token when clicked and puts it on the clipboard.
        Card("Local API", footer: "Listens on 127.0.0.1 only. Each request needs the token. Add the MCP server to Claude Code with: claude mcp add atom -- node <ATOM folder>/apps/mac/src/mcp-serve.ts") {
            Row(title: "Local API", detail: apiDetail(on: settings.localApi)) {
                ThemedSwitch(isOn: settings.localApi, set: { settings.localApi = $0; tokenNote = nil; model.send(.apiSet(on: $0)) }, label: "Local API")
            }
            if settings.localApi, let api = model.apiStatus, api.on {
                RowDivider()
                Row(title: "Token", detail: tokenNote ?? "For the header Authorization: Bearer <token>") {
                    PillButton(title: "Copy token") { copyToken(api.tokenFile) }
                    PillButton(title: "Regenerate") { askingRegenerate = true }
                        .confirmationDialog("Make a new token?", isPresented: $askingRegenerate) {
                            Button("Make a new token", role: .destructive) {
                                model.send(.apiRegenerate)
                                tokenNote = "New token made. The old one no longer works. Copy the new one."
                            }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("Every tool that uses the old token (the MCP server, Hermes, scripts) stops working until you give it the new one.")
                        }
                }
                RowDivider()
                // ADR-121: the phone page. ATOM stays on 127.0.0.1; Tailscale Serve forwards one private name to it.
                Row(title: "Phone", detail: "Install Tailscale on the Mac and the phone. Run the command once, put your .ts.net name in .env as ATOM_API_HOST, restart ATOM, then open https://<name>/app on the phone. Steps: docs/mobile.md") {
                    PillButton(title: "Copy command") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("tailscale serve --bg \(api.port)", forType: .string)
                    }
                }
            }
        }
    }
}

extension ConnectionsSection {
    func apiDetail(on: Bool) -> String {
        guard on else { return "Other tools on this Mac can give ATOM goals and read results" }
        guard let api = model.apiStatus else { return "Starting…" }
        if let error = api.error { return error }
        return api.on ? "Listening on 127.0.0.1:\(api.port)" : "Starting…"
    }

    /// Reads the token file on click only; the token goes to the clipboard and nowhere else.
    func copyToken(_ path: String) {
        guard let token = try? String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            tokenNote = "Could not read \(path)"
            return
        }
        SecretClipboard.copy(token) // concealed, and cleared after 60 seconds
        tokenNote = "Copied. It leaves the clipboard in \(Int(SecretClipboard.clearAfter)) seconds."
    }
}
