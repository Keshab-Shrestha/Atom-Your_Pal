import Foundation
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    static func writeStudio(to directory: URL) {
        let suite = "atom.gallery.studio.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.status.apply(.running(pid: 1))
        let fixture = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"jobs":[{"id":101,"task":"Compare fictional Cedar venues","state":"running","createdAt":"2026-10-23T10:00:00Z","step":"Reading the venue notes"}]},{"id":"kame","name":"Kame","role":"coder","available":true,"jobs":[{"id":102,"task":"Review the Cedar landing page","state":"queued","createdAt":"2026-10-23T10:00:00Z","held":"Waiting for your plan review","planStatus":"awaiting","planFirst":true}]},{"id":"puff","name":"Puff","role":"designer","available":true,"jobs":[{"id":103,"task":"Draw the fictional Cedar invitation","state":"done","createdAt":"2026-10-23T10:00:00Z","title":"Cedar invitation"}]},{"id":"quill","name":"Quill","role":"documenter","available":true,"jobs":[]},{"id":"penny","name":"Penny","role":"researcher","available":true,"jobs":[]},{"id":"hana","name":"Hana","role":"researcher","available":true,"jobs":[]},{"id":"tinker","name":"Tinker","role":"improver","available":true,"jobs":[]}]}"#
        do {
            let ready = try decodeEvent(#"{"type":"ready","protocol":1,"provider":"codex","model":"fixture","microphone":"fixture","voice":false}"#)
            model.status.apply(ready); model.apply(ready)
            model.apply(try decodeEvent(fixture))
        } catch {
            FileHandle.standardError.write(Data("gallery: invalid studio fixture: \(error)\n".utf8))
        }
        model.chats = ChatList(chats: [], current: "gallery")
        model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = .floor
        for (theme, name, size): (AppTheme, String, CGSize) in [(.void, "42-studio-dark", CGSize(width: 1080, height: 760)), (.daylight, "42-studio-light", CGSize(width: 1080, height: 760)), (.daylight, "42-studio-compact", CGSize(width: 760, height: 560))] {
            model.settings.theme = theme
            save(HelpersView(model: model).frame(width: size.width, height: size.height).environment(\.islandSnapshot, true), name: name, to: directory)
        }
        save(AppIconArt.icon, name: "42-orbit-app-icon", to: directory)
    }
}
