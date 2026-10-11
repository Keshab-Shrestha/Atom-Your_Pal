import AppKit
import UserNotifications
import ZenoIslandCore

/// ADR-091: posts ZENO's macOS notifications: what `NoticeWatcher` finds new in the team, and an approval card while
/// ZENO is not in front. Each kind can be turned off in Settings. Only in ZENO.app: macOS gives notifications to app
/// bundles, not to a bare development build. Clicking one opens the task in the ZENO window.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private var watcher = NoticeWatcher()
    private let settings: IslandSettings
    private let center: UNUserNotificationCenter?
    /// Opens the window, on the task if the notification names one.
    var onOpen: ((Int?) -> Void)?

    init(settings: IslandSettings) {
        self.settings = settings
        center = Bundle.main.bundleURL.pathExtension == "app" ? UNUserNotificationCenter.current() : nil
        super.init()
        center?.delegate = self
        center?.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func update(_ list: HelpersList?, plan: PlanUsage?) {
        guard let list else { return }
        for notice in watcher.notices(for: list, plan: plan) where settings.notifies(notice.kind) { post(notice) }
    }

    /// ZENO asks for an OK on Pal's card; told only while ZENO is not the app in front.
    func approval(_ request: ApprovalRequest) {
        guard settings.notifies(.needsYou), !NSApp.isActive else { return }
        post(AppNotice(kind: .needsYou, title: "ZENO asks for your OK", body: NoticeWatcher.short(request.summary), key: "approval-\(request.id)"))
    }

    private func post(_ notice: AppNotice) {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = .default
        content.threadIdentifier = notice.kind.rawValue
        if let task = notice.taskId { content.userInfo = ["task": task] }
        center.add(UNNotificationRequest(identifier: notice.key, content: content, trigger: nil))
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let task = response.notification.request.content.userInfo["task"] as? Int
        await MainActor.run { onOpen?(task) }
    }
}
