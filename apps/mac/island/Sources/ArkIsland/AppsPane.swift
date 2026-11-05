import SwiftUI
import WebKit
import ArkIslandCore

/// Apps (2026-11-05): small apps the agent made for you ("make me a habit tracker"), each approved on a card. Open one and it runs here, in a
/// locked-down web view with no network and no files; it keeps its own notes through ARK. An app is changed or made in a chat.
/// 2026-11-06 (Keshab: "merge that into apps … one page"): panels live here too, as simple apps used in place, in one grid with the rest.
struct AppsPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let open = model.openApp {
            AppRunnerPane(model: model, app: open)
        } else {
            list
        }
    }

    private var list: some View {
        let apps = model.apps ?? []
        let panels = model.panels?.panels ?? []
        return ScrollViewReader { reader in
            Scrollable {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Apps").appFont(theme.pageTitleFont()).foregroundStyle(theme.text.color)
                            Text("What ARK builds for you. Simple apps (lists, counters, charts and buttons) work right here; custom apps open on their own, in a sandbox with no network.")
                                .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        NewAppMenu(model: model)
                    }
                    if let problem = model.panels?.problem { ProblemLine(text: problem) }
                    if model.apps == nil && model.panels == nil {
                        LoadingStateView(text: "Loading apps…", retry: { model.send(.appsList); model.send(.panelsList) })
                    } else if apps.isEmpty && panels.isEmpty {
                        EmptyStateView(title: "No apps yet", detail: "Ask ARK in a chat: \"Make me a habit tracker\" or \"Make me a panel with a reading list and a water counter.\" You approve it first.")
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                        ForEach(apps) { app in AppCard(model: model, app: app) }
                        ForEach(panels) { panel in
                            PanelCard(model: model, panel: panel, manage: true)
                                .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                                    .strokeBorder(model.focusedPanel == panel.id ? theme.accent.color : .clear, lineWidth: 2))
                                .id("panel:" + panel.id)
                        }
                    }
                }
                .padding(24)
            }
            .onAppear {
                model.send(.appsList); model.send(.panelsList)
                if let id = model.focusedPanel { reader.scrollTo("panel:" + id, anchor: .top) }
            }
            .onChange(of: model.focusedPanel) { _, id in
                if let id { withAnimation(.easeOut(duration: 0.25)) { reader.scrollTo("panel:" + id, anchor: .top) } }
            }
            // Opened from the rail before the panels arrived: scroll once they do.
            .onChange(of: panels.count) { _, _ in
                if let id = model.focusedPanel { reader.scrollTo("panel:" + id, anchor: .top) }
            }
            .onDisappear { model.focusedPanel = nil }
        }
    }
}

/// One "New app" button: a simple app (a panel, made in seconds) or a custom app (its own screen and logic). Both start in a chat.
private struct NewAppMenu: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let label = Label("New app", systemImage: "plus").appFont(.system(size: 12, weight: .semibold))
        if snapshot {
            Button {} label: { label }.buttonStyle(.borderedProminent).tint(theme.accent.color).foregroundStyle(theme.onAccent.color)
        } else {
            Menu {
                Button { model.askForPanel() } label: { Label("Simple app: lists, counters, charts, buttons", systemImage: "square.grid.2x2") }
                Button { model.askForApp() } label: { Label("Custom app: its own screen and logic", systemImage: "app.dashed") }
            } label: { label }
            .menuStyle(.borderedButton).fixedSize()
            .accessibilityLabel("New app")
        }
    }
}

private struct AppCard: View {
    let model: IslandModel
    let app: AppItem
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Glyph(systemName: "app.dashed").appFont(.system(size: 16)).foregroundStyle(theme.text2.color)
                    .frame(width: 36, height: 36).background(theme.fill3.color, in: RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(app.name).appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                    Text(app.ask ? "Can ask ARK questions" : "Works on its own").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
                Spacer(minLength: 0)
            }
            Text(app.description).appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                PillButton(title: "Open", symbol: "play.fill", prominent: true) { model.openAppPage(app.id) }
                Spacer()
                IconButton(symbol: "trash", label: "Remove \(app.name)", diameter: ControlMetrics.buttonHeight) { model.send(.appRemove(id: app.id)) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.border.color, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

/// A running app: a bar with Back and the name, then the sandboxed page.
private struct AppRunnerPane: View {
    let model: IslandModel
    let app: AppOpened
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                IconButton(symbol: "chevron.left", label: "Back to Apps", diameter: ControlMetrics.buttonHeight) { model.closeAppPage() }
                Text(app.name).appFont(.system(size: 14, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                Text(app.ask ? "may ask ARK" : "sandboxed").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            if let problem = app.problem {
                EmptyStateView(title: "This app is not here", detail: problem)
            } else if snapshot {
                Text("The app runs here.").appFont(.system(size: 12)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                AppWebView(model: model, app: app).id(app.id)
            }
        }
    }
}

/// The sandbox. A fresh, non-persistent web view per app: the page gets only the bridge script, and every way out is shut:
///  - the page's own policy (`AppBridge.policy`, first in the document) allows no network, frames or forms;
///  - a content rule blocks every http(s) load as well, in case the policy is ever removed;
///  - the navigation delegate cancels everything after the first load, and pop-ups and downloads are refused;
///  - the only message handler is `ark`, whose calls are checked by `AppBridge.parse` here and again by the runtime.
private struct AppWebView: NSViewRepresentable {
    let model: IslandModel
    let app: AppOpened

    func makeCoordinator() -> Coordinator { Coordinator(model: model, appId: app.id) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.addUserScript(WKUserScript(source: AppBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        config.userContentController.add(context.coordinator, name: "ark")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        context.coordinator.web = view
        model.appReplyHandler = { [weak coordinator = context.coordinator] reply in coordinator?.deliver(reply) }
        let html = AppBridge.page(html: app.html)
        let rules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "ark-app-block", encodedContentRuleList: rules) { list, _ in
            DispatchQueue.main.async {
                if let list { view.configuration.userContentController.add(list) }
                view.loadHTMLString(html, baseURL: URL(string: "about:blank"))
            }
        }
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {}

    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "ark")
        coordinator.model.appReplyHandler = nil
        view.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        let model: IslandModel
        let appId: String
        weak var web: WKWebView?
        private var loaded = false

        init(model: IslandModel, appId: String) { self.model = model; self.appId = appId }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let call = AppBridge.parse(message.body) else { return }
            model.send(.appCall(app: appId, call: call))
        }

        func deliver(_ reply: AppReply) {
            guard reply.app == appId else { return }
            web?.evaluateJavaScript(reply.script, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // The first load is the app's own page. Every other navigation (a link, a script's location change, a form) is cancelled.
            if !loaded, action.request.url?.scheme == "about" { loaded = true; decisionHandler(.allow); return }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            decisionHandler(response.canShowMIMEType ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    }
}
