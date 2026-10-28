import Foundation
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// Visual acceptance scenes use fictional data and isolated preferences. They make no runtime/model calls.
    static func writeWorkspaceDesign(to directory: URL) {
        let suite = "atom.gallery.workspace-design.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.status.apply(.running(pid: 1))
        let fixtures = [
            #"{"type":"ready","protocol":1,"provider":"codex","model":"gpt-6-luna","microphone":"fixture","voice":false}"#,
            #"{"type":"chats","current":"cedar","projects":[{"id":"p","name":"Cedar studio","folderLabel":"~/Documents/Cedar","agentId":"cedar-coder","archived":false,"web":false}],"currentProjectId":"p","chats":[{"id":"cedar","title":"A thoughtful launch","projectId":"p","messages":4},{"id":"notes","title":"Notes for the next chapter","projectId":"p","messages":2},{"id":"review","title":"Review the launch page","messages":3}]}"#,
            #"{"type":"workspace","request":"gallery","chat":"cedar","project":"p","ok":true,"action":"list","root":"/Users/fictional/Documents/Cedar","path":"","entries":[{"path":"src","name":"src","directory":true},{"path":"README.md","name":"README.md","directory":false},{"path":"launch-notes.md","name":"launch-notes.md","directory":false}]}"#,
            #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"jobs":[]},{"id":"quill","name":"Quill","role":"documenter","available":true,"jobs":[]},{"id":"kame","name":"Kame","role":"coder","available":true,"jobs":[]}]}"#
        ]
        for fixture in fixtures {
            do {
                let event = try decodeEvent(fixture); model.apply(event); model.status.apply(event)
                if case .workspace(let value) = event { model.workspace.response = value }
            }
            catch { FileHandle.standardError.write(Data("gallery: workspace design fixture: \(error)\n".utf8)) }
        }
        model.conversation.replay([
            ChatLine(fromUser: true, text: "Let's make the Cedar launch feel a little more considered. What should we start with?"),
            ChatLine(fromUser: false, text: "Start with one clear promise: **a calmer place to do your best work.**\n\nKeep the first release focused:\n\n1. A conversation that remembers where you left off.\n2. Project files and changes beside your chat.\n3. Clear progress, with you in control.\n\nI can help shape the announcement when you're ready."),
            ChatLine(fromUser: true, text: "That feels right. Keep the announcement short and welcoming."),
            ChatLine(fromUser: false, text: "**Meet Cedar.**\n\nA little less switching. A little more focus. One thoughtful workspace for your conversations, projects and next steps.")
        ])
        // Dashboard cards exercise the full available width with fictional local usage.
        if let event = try? decodeEvent(#"{"type":"helpers","apps":[],"usage":{"today":{"input":2400,"output":900,"cacheRead":190000,"cacheWrite":38000,"dollars":0.42,"runs":6},"week":{"input":19000,"output":7600,"cacheRead":1400000,"cacheWrite":290000,"dollars":3.1,"runs":41},"days":[],"byWorker":[],"byModel":[]},"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"jobs":[]}]}"#) { model.apply(event) }
        model.windowPage = .chat
        model.workspace.tab = "files"
        for theme in [AppTheme.sapphire, .champagne, .emerald, .plum, .cobalt, .teal] {
            model.settings.theme = theme; model.workspace.shown = true
            save(HelpersView(model: model).frame(width: 1440, height: 900).environment(\.islandSnapshot, true),
                 name: "43-workspace-\(theme.rawValue)", to: directory)
        }
        model.settings.theme = .sapphire; model.workspace.shown = false
        save(HelpersView(model: model).frame(width: 1440, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-chat-wide", to: directory)
        save(HelpersView(model: model).frame(width: 760, height: 640).environment(\.islandSnapshot, true), name: "43-workspace-compact", to: directory)
        model.workspace.shown = true
        save(HelpersView(model: model).frame(width: 760, height: 640).environment(\.islandSnapshot, true), name: "43-workspace-compact-covered", to: directory)
        model.settings.sidebarHidden = true
        save(HelpersView(model: model).frame(width: 1100, height: 760).environment(\.islandSnapshot, true), name: "43-workspace-sidebar-hidden", to: directory)
        model.settings.sidebarHidden = false; model.workspace.shown = false
        model.windowPage = .settings; model.settingsPage = .appearance
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-appearance", to: directory)
        model.settingsPage = .general
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-general", to: directory)
        model.settingsPage = .computer
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-computer", to: directory)
        model.settingsPage = .notifications
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-notifications", to: directory)
        model.settingsPage = .connections
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-connections", to: directory)
        model.settingsPage = .privacy
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-privacy", to: directory)
        model.windowPage = .dashboard
        save(HelpersView(model: model).frame(width: 1440, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-dashboard-wide", to: directory)
        model.windowPage = .scheduled
        save(HelpersView(model: model).frame(width: 1100, height: 760).environment(\.islandSnapshot, true), name: "43-workspace-scheduled", to: directory)
        model.windowPage = .plugins
        save(HelpersView(model: model).frame(width: 1100, height: 760).environment(\.islandSnapshot, true), name: "43-workspace-plugins", to: directory)
        model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = .floor
        save(HelpersView(model: model).frame(width: 1100, height: 760).environment(\.islandSnapshot, true), name: "43-workspace-board", to: directory)
        // Font changes reflow real native text; the rail's physical width stays 51 points.
        model.windowPage = .chat; model.workspace.shown = false
        for size in [AppTextSize.small, .large, .extraLarge] {
            model.settings.textSize = size
            save(HelpersView(model: model).frame(width: 1440, height: 900).environment(\.islandSnapshot, true),
                 name: "43-workspace-font-\(size.rawValue)", to: directory)
        }
        save(HelpersView(model: model).frame(width: 760, height: 640).environment(\.islandSnapshot, true), name: "43-workspace-font-compact", to: directory)
        model.windowPage = .settings; model.settingsPage = .appearance
        save(HelpersView(model: model).frame(width: 1100, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-font-appearance", to: directory)
        model.windowPage = .dashboard
        save(HelpersView(model: model).frame(width: 1440, height: 900).environment(\.islandSnapshot, true), name: "43-workspace-font-dashboard", to: directory)

    }
}
