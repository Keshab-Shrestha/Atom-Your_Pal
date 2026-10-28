import AppKit
import SwiftUI
import WebKit
import os
import AtomIslandCore

/// What a panel shows. `revision` rises with each change; the page ignores a message that is not newer.
struct WebPanelData {
    let revision: Int
    let payload: [String: Any]
}

/// A bundled, read-only web page beside the native UI (ADR-211, docs/web-panel-contract.md). The page shows data and
/// asks for intents; Swift decides. It loads once from the app's own `web/<panel>/` folder, uses no network and keeps
/// nothing between loads. Outside the built app (no bundled page) and in snapshots it shows a plain note instead.
struct WebPanelView: View {
    let panel: String
    let label: String
    var allowedIntents: Set<String> = []
    var data: WebPanelData?
    /// Change this to tell the page to start over (a different chat or task).
    var resetKey = ""
    /// The ground the page sits on, when it is not the window's.
    var background: RGBA?
    var onResize: (CGFloat) -> Void = { _ in }
    var onIntent: (String, [String: String]) -> Void = { _, _ in }

    @Environment(\.theme) private var theme
    @Environment(\.appTextSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        if !snapshot, let entry = Self.entry(for: panel) {
            WebPanelRepresentable(
                entry: entry, panel: panel, allowedIntents: allowedIntents,
                theme: WebPanelTheme(palette: theme, textScale: textSize.scale, reduceMotion: reduceMotion, background: background),
                background: (background ?? theme.surfaceSolid).nsColor, data: data, resetKey: resetKey, onResize: onResize, onIntent: onIntent
            )
            .accessibilityLabel(label)
        } else {
            Text("\(label) shows in the built app.").appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
        }
    }

    /// The panel's entry page in the app bundle, or nil when it is not there.
    static func entry(for panel: String) -> URL? {
        guard WebPanelMessage.isPanelName(panel),
              let url = Bundle.main.resourceURL?.appendingPathComponent("web/\(panel)/index.html"),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }
}

private struct WebPanelRepresentable: NSViewRepresentable {
    let entry: URL
    let panel: String
    let allowedIntents: Set<String>
    let theme: WebPanelTheme
    let background: NSColor
    let data: WebPanelData?
    let resetKey: String
    let onResize: (CGFloat) -> Void
    let onIntent: (String, [String: String]) -> Void

    func makeCoordinator() -> WebPanelCoordinator {
        WebPanelCoordinator(entry: entry, panel: panel, allowedIntents: allowedIntents)
    }

    func makeNSView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(WebPanelMessageHandler(coordinator), name: WebPanelCoordinator.handlerName)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        view.underPageBackgroundColor = background
        coordinator.attach(view)
        update(coordinator)
        view.loadFileURL(entry, allowingReadAccessTo: coordinator.readAccess)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        view.underPageBackgroundColor = background
        update(context.coordinator)
    }

    static func dismantleNSView(_ view: WKWebView, coordinator: WebPanelCoordinator) {
        view.stopLoading()
        view.configuration.userContentController.removeScriptMessageHandler(forName: WebPanelCoordinator.handlerName)
    }

    private func update(_ coordinator: WebPanelCoordinator) {
        coordinator.update(theme: theme, data: data, resetKey: resetKey, onResize: onResize, onIntent: onIntent)
    }
}

/// The web view keeps its script message handlers alive, so the handler holds the coordinator weakly.
@MainActor private final class WebPanelMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WebPanelCoordinator?
    init(_ target: WebPanelCoordinator) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.receive(message.body)
    }
}

@MainActor final class WebPanelCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let handlerName = "atomPanel"
    private static let log = Logger(subsystem: "dev.atom.island", category: "WebPanel")

    private var policy: WebPanelNavigationPolicy
    private let panel: String
    private let allowedIntents: Set<String>
    private weak var webView: WKWebView?
    private var isReady = false
    private var theme: WebPanelTheme?
    private var data: WebPanelData?
    private var resetKey = ""
    private var sentTheme: WebPanelTheme?
    private var sentRevision = -1
    private var sentResetKey = ""
    private var onResize: (CGFloat) -> Void = { _ in }
    private var onIntent: (String, [String: String]) -> Void = { _, _ in }

    init(entry: URL, panel: String, allowedIntents: Set<String>) {
        policy = WebPanelNavigationPolicy(entry: entry)
        self.panel = panel
        self.allowedIntents = allowedIntents
    }

    var readAccess: URL { policy.readAccess }

    func attach(_ view: WKWebView) { webView = view }

    func update(theme: WebPanelTheme, data: WebPanelData?, resetKey: String, onResize: @escaping (CGFloat) -> Void, onIntent: @escaping (String, [String: String]) -> Void) {
        self.theme = theme
        self.data = data
        self.resetKey = resetKey
        self.onResize = onResize
        self.onIntent = onIntent
        if isReady { flush() }
    }

    /// A message from the page. It is checked first; a refused message is dropped and one line is logged.
    func receive(_ body: Any) {
        do {
            switch try WebPanelMessage.parse(body, allowedIntents: allowedIntents) {
            case .ready(let name):
                guard name == panel, let theme else { return }
                isReady = true
                sentTheme = theme
                sentResetKey = resetKey
                send(WebPanelHost.initMessage(panel: panel, theme: theme))
                flush()
            case .resize(let height):
                onResize(CGFloat(height))
            case .intent(let name, let args):
                guard isReady else { return }
                onIntent(name, args)
            }
        } catch {
            Self.log.error("A web panel message was refused: \(String(String(describing: error).prefix(120)), privacy: .public)")
        }
    }

    /// Sends what changed since the last send: the theme, a reset, newer data.
    private func flush() {
        if let theme, theme != sentTheme {
            sentTheme = theme
            send(WebPanelHost.themeMessage(theme))
        }
        if resetKey != sentResetKey {
            sentResetKey = resetKey
            sentRevision = -1
            send(WebPanelHost.resetMessage())
        }
        if let data, data.revision > sentRevision {
            sentRevision = data.revision
            send(WebPanelHost.dataMessage(revision: data.revision, payload: data.payload))
        }
    }

    /// The message goes as an argument, never as built script text.
    private func send(_ message: [String: Any]) {
        webView?.callAsyncJavaScript("window.atomPanel.receive(message)", arguments: ["message": message], in: nil, in: .page) { result in
            if case .failure(let error) = result {
                Self.log.error("A web panel did not take a message: \(String(String(describing: error).prefix(120)), privacy: .public)")
            }
        }
    }

    // MARK: WKNavigationDelegate and WKUIDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        decisionHandler(policy.allows(navigationAction.request.url) ? .allow : .cancel)
    }

    /// A panel never opens a window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        Self.log.error("A web panel's page process ended")
    }
}
