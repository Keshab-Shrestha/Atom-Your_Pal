import AppKit
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeChatDesign(to directory: URL) {
        for (name, theme, width, empty) in [
            ("31-chat-t3-dark", AppTheme.void, 1080.0, false),
            ("31-chat-t3-light", AppTheme.daylight, 1080.0, false),
            ("31-chat-t3-empty", AppTheme.daylight, 760.0, true)
        ] {
            let suite = "atom.gallery.chat-design.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            model.status.apply(.running(pid: 1))
            if let event = try? decodeEvent(#"{"type":"ready","protocol":1,"provider":"codex","model":"gpt-6-luna","microphone":"","voice":false}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"info","provider":"codex","model":"gpt-6-luna","providers":[{"id":"codex","name":"Codex","available":true,"models":[{"id":"gpt-6-luna","name":"GPT-6 Luna"}]}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","access":"checked","reasoning":{"provider":"codex","model":"gpt-6-luna","levels":["low","medium","high"],"default":"low","selected":"medium","effective":"medium"},"chats":[{"id":"cedar","title":"Cedar launch plan","updatedAt":"2026-10-19T00:00:00Z","messages":4}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
            if !empty {
                model.conversation.replay([
                    ChatLine(fromUser: true, text: "Help me prepare the Cedar launch."),
                    ChatLine(fromUser: false, text: "Start with the launch outline. Keep the audience, release date and owner together so the next decision is easy to review.\n\nWe can work through each item here and keep the agreed details in your chat brief."),
                    ChatLine(fromUser: true, text: "The fictional launch is on Thursday. First, write a short outline with the announcement, the product walkthrough and the follow-up notes. Keep it concise so the team can review it in one sitting."),
                    ChatLine(fromUser: false, text: "**Cedar launch outline**\n\n1. Announce what is available and who it helps.\n2. Walk through the everyday workflow.\n3. Collect questions and assign follow-up owners.\n\nThe next step is to review the outline before preparing the announcement.")
                ])
            }
            save(HelpersView(model: model).frame(width: width, height: 820).environment(\.islandSnapshot, true), name: name, to: directory)
            if !empty {
                save(HelpersView(model: model).frame(width: 959, height: 820).environment(\.islandSnapshot, true),
                     name: name + "-everyday", to: directory)
                model.settings.textSize = .extraLarge
                save(HelpersView(model: model).frame(width: 760, height: 820).environment(\.islandSnapshot, true),
                     name: name + "-large-narrow", to: directory)
                model.settings.textSize = .standard
                save(Composer(model: model, initialDraft: String(repeating: "A longer fictional Cedar draft to review before sending.\n", count: 6))
                    .padding(20).frame(width: 620).environment(\.islandSnapshot, true).themed(ChatAppearance.palette(theme: theme)),
                     name: name + "-draft", to: directory)
            }
            if !empty {
                model.windowPage = .settings
                model.settingsPage = .appearance
                save(HelpersView(model: model).frame(width: 1080, height: 820).environment(\.islandSnapshot, true),
                     name: theme == .void ? "32-shell-settings-dark" : "32-shell-settings-light", to: directory)
                model.settingsPage = .general
                save(HelpersView(model: model).frame(width: 1080, height: 820).environment(\.islandSnapshot, true),
                     name: theme == .void ? "32-shell-settings-general-dark" : "32-shell-settings-general-light", to: directory)
            }

        }
    }
}
