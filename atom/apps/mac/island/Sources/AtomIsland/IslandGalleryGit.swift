import Foundation
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeGitWorkspace(to directory: URL) {
        let suite = "atom.gallery.git.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func model(action: String, content: [String: Any]) -> IslandModel {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","currentProjectId":"p","chats":[],"projects":[{"id":"p","name":"Cedar","folderLabel":"~/Documents/Cedar","missing":false,"archived":false,"chatCount":1,"web":false}]}"#) { model.apply(event) }
            model.workspace.shown = true; model.workspace.tab = "git"
            var fields: [String: Any] = ["type": "workspace", "request": "gallery", "chat": "cedar", "project": "p", "action": action, "path": "", "ok": true]
            fields.merge(content) { _, value in value }
            if let data = try? JSONSerialization.data(withJSONObject: fields), case .workspace(let response) = try? decodeEvent(String(decoding: data, as: UTF8.self)) { model.workspace.response = response }
            return model
        }
        let status = model(action: "git", content: ["gitStatus": [
            "branch": "feature/cedar-launch", "head": String(repeating: "a", count: 40), "upstream": "origin/main", "ahead": 2, "behind": 1,
            "limited": false, "filtersDisabled": false,
            "files": [["path": "launch.txt", "section": "staged", "status": "M "],
                      ["path": "src/outline.md", "section": "unstaged", "status": " M"],
                      ["path": "draft.md", "section": "untracked", "status": "??"],
                      ["path": "src/schedule.txt", "section": "conflict", "status": "UU"]]
        ]])
        let review = model(action: "gitReview", content: ["path": "src/schedule.txt", "section": "conflict", "gitReview": [
            "path": "src/schedule.txt", "section": "conflict", "before": "Cedar launch on Wednesday.\nDoors open at noon.\n", "after": "Cedar launch on Thursday.\nDoors open at noon.\n",
            "base": "Cedar launch day to be confirmed.\nDoors open at noon.\n", "beforeLabel": "Ours", "afterLabel": "Theirs",
            "note": "Unmerged versions, not a proposed resolution. Base is shown separately. No file or index entry is changed."
        ]])
        save(ProjectWorkspaceView(model: status).frame(width: 420, height: 640).environment(\.islandSnapshot, true).themed(AppTheme.void.palette), name: "30-project-git-status", to: directory)
        save(ProjectWorkspaceView(model: review).frame(width: 560, height: 640).environment(\.islandSnapshot, true).themed(AppTheme.daylight.palette).background(AppTheme.daylight.palette.surfaceFill(solid: true)), name: "30-project-git-conflict", to: directory)
    }
}
