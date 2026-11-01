import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// 2026-11-02: a reply with a bar chart, a ring, a file image and a web image waiting for "Show image".
    static func writeReplyMedia(to directory: URL) {
        save(AppIconArt.icon, name: "46-reply-media-sample", to: directory)
        let sample = directory.appendingPathComponent("46-reply-media-sample.png").path
        let reply = """
        Here is the week, by provider.

        ```chart
        {"type":"bar","title":"Tokens per day (thousands)","labels":["Mon","Tue","Wed","Thu","Fri"],"series":[{"name":"Claude","values":[42,38,51,47,33]},{"name":"Codex","values":[12,18,9,22,15]}]}
        ```

        ```chart
        {"type":"pie","title":"Where the time went","labels":["Chat","Agents","Voice"],"series":[{"name":"Hours","values":[6,3.5,1]}]}
        ```

        The app icon, from a file on this Mac:
        ![ARK app icon](\(sample))
        ![A Cedar venue photo](https://example.com/cedar/venue.jpg)
        """
        for (name, theme) in [("46-reply-media-dark", AppTheme.void), ("46-reply-media-light", AppTheme.daylight)] {
            let suite = "ark.gallery.reply-media.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            model.status.apply(.running(pid: 1))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Weekly usage","updatedAt":"2026-10-19T00:00:00Z","messages":2}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
            model.conversation.replay([ChatLine(fromUser: true, text: "Chart my week and show me the app icon."), ChatLine(fromUser: false, text: reply)])
            save(HelpersView(model: model).frame(width: 1080, height: 1500).environment(\.islandSnapshot, true), name: name, to: directory)
        }
    }
}
