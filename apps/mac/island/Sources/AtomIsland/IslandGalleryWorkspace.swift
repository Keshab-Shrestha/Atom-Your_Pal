import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeWorkspace(to directory: URL) {
        let suite = "atom.gallery.workspace.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func model(_ response: String, tab: String = "files") -> IslandModel {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","currentProjectId":"p","chats":[{"id":"cedar","title":"Cedar launch","messages":2}],"projects":[{"id":"p","name":"Cedar","folderLabel":"~/Documents/Cedar","missing":false,"archived":false,"chatCount":1,"web":false}]}"#) { model.apply(event) }
            model.workspace.shown = true; model.workspace.tab = tab
            if case .workspace(let value) = try? decodeEvent(response) { model.workspace.response = value; model.workspace.notice = value.notice }
            return model
        }
        let prefix = #""type":"workspace","request":"gallery","chat":"cedar","project":"p","ok":true,"root":"/Users/fictional/Documents/Cedar","path":"""#
        let files = model("{" + prefix + #", "action":"list","entries":[{"path":"src","name":"src","directory":true},{"path":"README.md","name":"README.md","directory":false},{"path":"launch-notes.md","name":"launch-notes.md","directory":false}]}"#)
        let changes = model("{" + prefix + #", "action":"changes","notice":"Tracked task edits only. Git-backed work and shell edits may have no checkpoint; use branch review.","changes":[{"job":42,"task":"Correct the fictional launch date","jobState":"done","path":"launch-notes.md","absolute":"/Users/fictional/Documents/Cedar/launch-notes.md","kind":"modified","state":"ready"},{"job":40,"task":"Write the launch outline","jobState":"done","path":"README.md","absolute":"/Users/fictional/Documents/Cedar/README.md","kind":"created","state":"undone"}]}"#, tab: "changes")
        let preview = model(#"{"type":"workspace","request":"gallery","chat":"cedar","project":"p","ok":true,"action":"read","root":"/Users/fictional/Documents/Cedar","path":"launch-notes.md","text":"Cedar launch\n\nLaunch day: Wednesday\nDoors open at noon.\n\nNext step: review the one-page outline.\n"}"#)
        let review = model(#"{"type":"workspace","request":"gallery","chat":"cedar","project":"p","ok":true,"action":"review","root":"/Users/fictional/Documents/Cedar","path":"launch-notes.md","review":{"path":"launch-notes.md","absolute":"/Users/fictional/Documents/Cedar/launch-notes.md","before":"Cedar launch on Wednesday. Doors open at noon.\n","after":"Cedar launch on Thursday. Doors open at noon.\n","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","note":"Original copy and current file verified. Undo refuses later edits."}}"#, tab: "changes")
        save(ProjectWorkspaceView(model: review).frame(width: 420, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "29-project-workspace-review", to: directory)
        let sheet = HStack(alignment: .top, spacing: 16) {
            ProjectWorkspaceView(model: files)
            ProjectWorkspaceView(model: changes)
            ProjectWorkspaceView(model: preview)
        }.frame(width: 1100, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.void.palette)
        save(sheet, name: "29-project-workspace", to: directory)
        let wide = HStack(spacing: 0) {
            Text("Project chat").frame(maxWidth: .infinity, maxHeight: .infinity)
            ProjectWorkspaceView(model: files).frame(width: 340)
        }.frame(width: 820, height: 580).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette)
        save(wide, name: "29-project-workspace-daylight", to: directory)
        let chooser = model("{" + prefix + #", "action":"list","entries":[]}"#)
        chooser.workspace.tab = "home"
        save(ProjectWorkspaceView(model: chooser).frame(width: 420, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "35-workspace-chooser", to: directory)
        let browser = model("{" + prefix + #", "action":"list","entries":[]}"#, tab: "browser")
        save(ProjectWorkspaceView(model: browser).frame(width: 420, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "38-workspace-browser-dark", to: directory)
        save(ProjectWorkspaceView(model: browser).frame(width: 300, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "38-workspace-browser-compact", to: directory)
        browser.workspaceBrowser.address = "file:///tmp/Cedar.html"; browser.workspaceBrowser.navigate()
        save(ProjectWorkspaceView(model: browser).frame(width: 420, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "38-workspace-browser-refusal", to: directory)
        let plainBrowser = IslandModel(settings: IslandSettings(defaults: defaults))
        plainBrowser.workspace.shown = true; plainBrowser.workspace.tab = "browser"
        save(ProjectWorkspaceView(model: plainBrowser).frame(width: 420, height: 600).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette), name: "38-workspace-browser-plain", to: directory)
        files.windowPage = .chat; files.status.apply(.running(pid: 1)); files.settings.theme = .daylight
        save(HelpersView(model: files).frame(width: 1160, height: 720).environment(\.islandSnapshot, true), name: "35-workspace-split", to: directory)
        save(HelpersView(model: files).frame(width: 760, height: 640).environment(\.islandSnapshot, true), name: "35-workspace-compact", to: directory)

    }
}
