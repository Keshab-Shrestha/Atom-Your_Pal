import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeProjectSources(to directory: URL) {
        let suite = "atom.gallery.sources.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.status.apply(.running(pid: 1)); model.windowPage = .chat
        if let event = try? decodeEvent(#"{"type":"chats","current":"plain","chats":[{"id":"plain","title":"Plan the release notes","messages":2},{"id":"cedar-chat","title":"Review the Cedar launch","messages":2,"projectId":"cedar"}],"projects":[{"id":"cedar","name":"Cedar","folderLabel":"~/Developer/Cedar","chatCount":1,"web":false}]}"#) { model.apply(event) }
        model.conversation.replay([ChatLine(fromUser: true, text: "Help me outline the release notes."), ChatLine(fromUser: false, text: "Start with what changed, who it affects, and what to do next.")])
        save(ProjectSourceSheet(model: model).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "37-project-sources", to: directory)
        save(ProjectSourceSheet(model: model, source: .new, name: "Cedar launch", location: URL(fileURLWithPath: "/Users/fictional/Developer")).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "37-project-new-review", to: directory)
        save(ProjectSourceSheet(model: model, source: .github, name: "Cedar launch").environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "37-project-clone", to: directory)
        model.settings.theme = .daylight
        save(HelpersView(model: model).environment(\.islandSnapshot, true).frame(width: 1080, height: 720), name: "37-project-navigation", to: directory)
    }
}
