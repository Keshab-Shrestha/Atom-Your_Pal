import AppKit
import UserNotifications
import ArkIslandCore

/// ADR-091: posts ARK's macOS notifications: what `NoticeWatcher` finds new in the team, and an approval card while
/// ARK is not in front. Each kind can be turned off in Settings. Only in ARK.app: macOS gives notifications to app
/// bundles, not to a bare development build. Clicking one opens the task in the ARK window.
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

    /// ARK asks for an OK on Pal's card; told only while ARK is not the app in front.
    func approval(_ request: ApprovalRequest) {
        guard settings.notifies(.needsYou), !NSApp.isActive else { return }
        post(AppNotice(kind: .needsYou, title: "ARK asks for your OK", body: NoticeWatcher.short(request.summary), key: "approval-\(request.id)"))
    }

    /// A new daily brief: its first line only, never the whole brief.
    func brief(_ entry: BriefEntry) {
        guard settings.notifies(.brief) else { return }
        post(AppNotice(kind: .brief, title: "Your daily brief", body: NoticeWatcher.short(entry.lines.first ?? "It is ready."), key: "brief-\(entry.id)"))
    }

    /// A watch fired, or stopped on its own. Told even while ARK is in front: the user asked for it.
    func watch(_ notice: WatchNotice) {
        guard settings.notifies(.needsYou) else { return }
        post(AppNotice(kind: .needsYou, title: notice.stopped ? "ARK stopped a watch" : "ARK found what you were watching for", body: NoticeWatcher.short(notice.message), key: "watch-\(notice.id)"))
    }

    private func post(_ notice: AppNotice) {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = settings.notificationSounds ? .default : nil // ADR-097
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
