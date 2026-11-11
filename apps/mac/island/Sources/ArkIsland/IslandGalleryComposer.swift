import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// ADR-274: the composer while ARK answers, with two queued rows (the head drawn as hovered) and the Workers chip; and a chat
    /// with news since the last view, with Catch me up. Fictional data and isolated preferences only; no runtime calls.
    static func writeComposer(to directory: URL) {
        let suite = "ark.gallery.composer.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let iso = ISO8601DateFormatter()
        let ago = { (seconds: Double) in iso.string(from: Date().addingTimeInterval(-seconds)) }
        let helpers = #"{"type":"helpers","apps":[],"helpers":[{"id":"kame","name":"Kame","role":"coder","available":true,"jobs":[{"id":20,"task":"Ship the launch page","state":"running","chatId":"cedar","createdAt":"\#(ago(900))","step":"Merging the parts"},{"id":22,"task":"Write the hero copy","state":"done","chatId":"cedar","createdAt":"\#(ago(800))","endedAt":"\#(ago(300))"}]}]}"#
        func model(messages: Int, busy: Bool) -> IslandModel {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            let events = [#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Launch page for Cedar","messages":\#(messages)}]}"#, helpers]
                + (busy ? [#"{"type":"state","state":"thinking"}"#] : [])
            for line in events {
                do { let event = try decodeEvent(line); model.status.apply(event); model.apply(event) }
                catch { FileHandle.standardError.write(Data("gallery: composer fixture: \(error)\n".utf8)) }
            }
            return model
        }
        let busy = model(messages: 6, busy: true)
        busy.queueMessage("Then add a test for a client that retries exactly at the limit.", draft: ComposerDraft())
        busy.queueMessage("After that, write the limiter's options into the README and keep it short.", draft: ComposerDraft())
        // Catch me up: the chat had 4 messages and a running job when it was last on screen; now it has 6 and the job is done.
        let back = model(messages: 6, busy: false)
        back.settings.chatSeen = ["cedar": ChatSeen(at: Date().addingTimeInterval(-7200), messages: 4, jobs: ["20": "running", "22": "running"])]
        back.chatViewStarted()
        if back.catchUpSince == nil { FileHandle.standardError.write(Data("gallery: composer fixture: Catch me up did not show\n".utf8)) }
        let turn = Conversation.Turn(id: 1, transcript: "Review the rate limiter for edge cases in how blocked clients retry.",
                                     reply: "Kame is on it. I will post what the review finds here.", outcome: .answered)
        for (model, name) in [(busy, "52-composer-queue"), (back, "52-composer-catch-up")] {
            for theme in [AppTheme.ember, .daylight] {
                model.settings.theme = theme
                let page = VStack(alignment: .leading, spacing: Spacing.turn) {
                    TurnView(turn: turn)
                    Spacer(minLength: 0)
                    Composer(model: model)
                }
                .padding(24).frame(width: 720, height: 420, alignment: .top)
                .background(theme.palette.surfaceSolid.color)
                .environment(\.theme, theme.palette).environment(\.islandSnapshot, true)
                save(page, name: "\(name)-\(theme == .ember ? "dark" : "light")", to: directory)
            }
        }
    }
}
