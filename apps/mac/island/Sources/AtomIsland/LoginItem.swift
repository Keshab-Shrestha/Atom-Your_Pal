import Foundation
import Observation
import ServiceManagement

/// Open ZENO at login, as a macOS Login Item (SMAppService). The state is read from the system each time, never
/// saved by ZENO, so it always matches System Settings → General → Login Items, where the user can also change it.
@MainActor @Observable
final class LoginItem {
    private(set) var enabled = false
    /// macOS wants the user to allow it in System Settings first.
    private(set) var needsApproval = false
    /// Why the last change failed, in plain words; nil when it worked.
    private(set) var error: String?
    /// False when ZENO is not running from an app bundle (e.g. `swift run`): login items need one.
    let available = Bundle.main.bundleURL.pathExtension == "app"

    init() { refresh() }

    func refresh() {
        guard available else { return }
        let status = SMAppService.mainApp.status
        enabled = status == .enabled
        needsApproval = status == .requiresApproval
    }

    func set(_ on: Bool) {
        guard available else { return }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            error = nil
        } catch {
            self.error = on
                ? "macOS did not allow it. Turn ZENO on in System Settings → General → Login Items."
                : "macOS did not allow it. Turn ZENO off in System Settings → General → Login Items."
        }
        refresh()
    }

    func openSystemSettings() { SMAppService.openSystemSettingsLoginItems() }
}
