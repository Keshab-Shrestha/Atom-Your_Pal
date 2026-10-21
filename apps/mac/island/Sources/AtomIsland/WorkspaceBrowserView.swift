import SwiftUI
import WebKit
import AtomIslandCore

struct WorkspaceBrowserView: View {
    let session: WorkspaceBrowserSession
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Button(action: session.back) { Image(systemName: "chevron.left").frame(width: 26, height: 26) }
                    .disabled(!session.canGoBack).accessibilityLabel("Browser back")
                Button(action: session.forward) { Image(systemName: "chevron.right").frame(width: 26, height: 26) }
                    .disabled(!session.canGoForward).accessibilityLabel("Browser forward")
                Button { session.loading ? session.stop() : session.reload() } label: {
                    Image(systemName: session.loading ? "xmark" : "arrow.clockwise").frame(width: 26, height: 26)
                }.disabled(!session.hasPage).accessibilityLabel(session.loading ? "Stop browser loading" : "Reload browser")
                Spacer(minLength: 0)
                Button("Reset", action: session.reset).font(.system(size: 11)).help("Clear this temporary browser session")
                    .accessibilityLabel("Reset browser session").disabled(!session.hasPage)
            }
            if snapshot {
                Text(session.address.isEmpty ? "Enter a web address…" : session.address).font(.system(size: 12)).foregroundStyle(theme.text3.color).padding(8)
            } else {
                HStack(spacing: 6) {
                    TextField("https://example.com or localhost:3000", text: Binding(get: { session.address }, set: { session.address = $0 }))
                        .textFieldStyle(.plain).font(.system(size: 12)).accessibilityLabel("Browser address")
                        .onSubmit { session.navigate() }
                    Button(action: session.navigate) { Image(systemName: "arrow.right").frame(width: 24, height: 24) }
                        .accessibilityLabel("Open browser address").disabled(session.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.padding(.horizontal, 8).padding(.vertical, 4)
                    .background(theme.fill2.color, in: RoundedRectangle(cornerRadius: 6))
            }
            if !session.title.isEmpty { Text(verbatim: session.title).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1) }
            if session.loading { ProgressView().controlSize(.small).accessibilityLabel("Loading browser page") }
            if let notice = session.notice {
                Text(verbatim: notice).font(.system(size: 11)).foregroundStyle(theme.attention.color)
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }
            if session.hasPage, !snapshot {
                WorkspaceWebContent(session: session).id(session.generation).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Spacer()
                    Image(systemName: "globe").font(.system(size: 24)).foregroundStyle(theme.text3.color)
                    Text("Browse beside your chat").font(.system(size: 14, weight: .medium))
                    Text("Open a web page or a local development server. Page content is not sent to the model automatically.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            }
            Text("Temporary session · clears when the chat changes")
                .font(.system(size: 10)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
        }
    }
}
private struct WorkspaceWebContent: NSViewRepresentable {
    let session: WorkspaceBrowserSession
    func makeNSView(context: Context) -> WKWebView { session.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
