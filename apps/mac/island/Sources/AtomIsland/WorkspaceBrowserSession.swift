import AppKit
import Observation
import WebKit
import AtomIslandCore

/// One ephemeral, user-operated WebKit session for the current chat. Never registered as an agent tool.
@MainActor @Observable
final class WorkspaceBrowserSession: NSObject, WKNavigationDelegate, WKUIDelegate {
    var address = ""
    private(set) var title = ""
    private(set) var loading = false
    private(set) var canGoBack = false
    private(set) var canGoForward = false
    private(set) var hasPage = false
    private(set) var notice: String?
    private(set) var generation = UUID()
    @ObservationIgnored private var current: WKWebView?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var attempted: URL?
    @ObservationIgnored private var navigating = false

    var webView: WKWebView {
        if let current { return current }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        let view = WorkspacePageView(frame: .zero, configuration: config)
        view.navigationDelegate = self; view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.setAccessibilityLabel("Workspace browser page")
        current = view
        observations = [view.observe(\.url, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self, weak view] in
                guard let self, let view, self.current === view else { return }
                if !self.navigating, self.notice == nil, let url = view.url, WorkspaceBrowserAddress.allows(url) { self.address = url.absoluteString }
            }
        }, view.observe(\.title, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self, weak view] in
                guard let self, let view, self.current === view else { return }; self.title = view.title ?? ""
            }
        }, view.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            Task { @MainActor [weak self, weak view] in
                guard let self, let view, self.current === view else { return }; self.loading = view.isLoading
                self.canGoBack = view.canGoBack; self.canGoForward = view.canGoForward
            }
        }]
        return view
    }
    func navigate() {
        guard let url = WorkspaceBrowserAddress.resolve(address) else { notice = WorkspaceBrowserAddress.refusal; return }
        notice = nil; navigating = true; attempted = url; address = url.absoluteString; hasPage = true
        webView.load(URLRequest(url: url, timeoutInterval: 30))
    }
    func back() { notice = nil; navigating = true; current?.goBack() }
    func forward() { notice = nil; navigating = true; current?.goForward() }
    func reload() {
        if (notice != nil || current?.url == nil), let attempted { address = attempted.absoluteString; navigate() }
        else { notice = nil; navigating = true; current?.reload() }
    }
    func stop() { current?.stopLoading(); loading = false; navigating = false }
    func reset() {
        observations.removeAll(); current?.stopLoading(); current?.navigationDelegate = nil; current?.uiDelegate = nil
        current = nil; attempted = nil; address = ""; title = ""; notice = nil; hasPage = false
        loading = false; navigating = false; canGoBack = false; canGoForward = false; generation = UUID()
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard current === webView else { decisionHandler(.cancel); return }
        guard let url = navigationAction.request.url, WorkspaceBrowserAddress.allows(url), !navigationAction.shouldPerformDownload else {
            notice = "Use HTTPS or local HTTP previews. Local files, external app links and downloads are unavailable."
            decisionHandler(.cancel); return
        }
        if navigationAction.targetFrame == nil {
            decisionHandler(.cancel); webView.load(navigationAction.request); return
        }
        if navigationAction.targetFrame?.isMainFrame == true { navigating = true; attempted = url; address = url.absoluteString; notice = nil }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        let attachment = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        guard current === webView, let url = navigationResponse.response.url, WorkspaceBrowserAddress.allows(url), navigationResponse.canShowMIMEType, !attachment else {
            if current === webView { notice = "Downloads are unavailable in this pane." }
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard current === webView else { return }; navigating = false
        if let url = webView.url, WorkspaceBrowserAddress.allows(url) { address = url.absoluteString; attempted = url }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard current === webView else { return }; loading = false; navigating = false
        canGoBack = webView.canGoBack; canGoForward = webView.canGoForward
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    private func failed(_ view: WKWebView, _ error: Error) {
        guard current === view else { return }; loading = false; navigating = false
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        notice = "The page could not load. Check the address and connection, then Reload."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard current === webView else { return }; loading = false; notice = "The page stopped. Reload to try again."
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard current === webView else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        notice = "File uploads are unavailable in this pane."; completionHandler(nil)
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    @available(macOS 27.0, *)
    func webView(_ webView: WKWebView, requestGeolocationPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) { notice = "This page requested a dialog. Dialogs are unavailable in this pane."; completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) { notice = "This page requested confirmation. Dialogs are unavailable in this pane."; completionHandler(false) }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) { notice = "This page requested input. Dialogs are unavailable in this pane."; completionHandler(nil) }
}

/// Native drops cannot silently supply local files to a website.
private final class WorkspacePageView: WKWebView {
    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation { [] }
    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool { false }
}
