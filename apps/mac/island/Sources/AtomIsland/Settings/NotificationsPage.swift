import AppKit
import SwiftUI
import AtomIslandCore

/// Which macOS notifications ATOM posts, the daily brief, and the Telegram bot that carries the same news to the phone.
struct NotificationsSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        // ADR-091: which macOS notifications ATOM posts.
        Card("Notifications", footer: "Shown by macOS. Titles and short reasons only, never a report's text. Allow ATOM in System Settings → Notifications if none appear.") {
            ForEach(Array(AppNotice.Kind.allCases.enumerated()), id: \.element) { index, kind in
                if index > 0 { RowDivider() }
                Row(title: kind.title, detail: Self.detail(kind)) {
                    ThemedSwitch(isOn: settings.notifies(kind), set: { settings.setNotifies(kind, $0) }, label: kind.title)
                }
            }
        }
        // ADR-098: ATOM's own Telegram bot. The names only, never the values.
        Card("Telegram", footer: model.telegramConnected
             ? "Only the chat in ATOM_TELEGRAM_CHAT_ID is served. Send /help to the bot for its commands. More: docs/telegram.md."
             : "Make a bot for ATOM with @BotFather. Add ATOM_TELEGRAM_BOT_TOKEN and ATOM_TELEGRAM_CHAT_ID to .env, then restart ATOM. Steps: docs/telegram.md in the ATOM folder.") {
            Row(title: "Telegram", detail: model.telegramConnected ? "Connected" : "Not set up") {
                StatusDot(color: model.telegramConnected ? theme.success.color : theme.text3.color, size: 8)
            }
            RowDivider()
            Row(title: "Send to Telegram", detail: "What needs you, finished goals and schedule results") {
                ThemedSwitch(isOn: settings.telegramPush, set: { settings.telegramPush = $0; model.send(.telegramSet(push: $0)) }, label: "Send to Telegram")
                    .disabled(!model.telegramConnected)
            }
        }
        BriefSettingsCard(model: model) // upgrades.md C3
    }
}

extension NotificationsSection {
    static func detail(_ kind: AppNotice.Kind) -> String {
        switch kind {
        case .needsYou: "A plan, a held task, a proposal, or ATOM asking for your OK"
        case .done: "A worker finished, with its report's title"
        case .failed: "A task failed, and why"
        case .planUse: "The Claude plan passing 80% of its five hours, or used up"
        case .brief: "Your daily brief is ready"
        }
    }
}

