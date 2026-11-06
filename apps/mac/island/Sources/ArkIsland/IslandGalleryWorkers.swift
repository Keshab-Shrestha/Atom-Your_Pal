import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// ADR-273: the Workers card in a chat and the job tree on the Board. A manager job with three workers (one quiet, one that
    /// needs you), and jobs that failed, stopped and still run. Fictional data and isolated preferences only; no runtime calls.
    static func writeWorkers(to directory: URL) {
        let suite = "ark.gallery.workers.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let ago = { (seconds: Double) in iso.string(from: Date().addingTimeInterval(-seconds)) }
        func job(_ id: Int, _ task: String, _ state: String, _ created: Double, _ extra: String = "") -> String {
            #"{"id":\#(id),"task":"\#(task)","state":"\#(state)","chatId":"cedar","createdAt":"\#(ago(created))"\#(extra)}"#
        }
        let ended = { (s: Double) in #","endedAt":"\#(ago(s))""# }
        let helpers = [
            #"{"id":"kame","name":"Kame","role":"coder","available":true,"jobs":[\#(job(20, "Ship the launch page", "running", 900, #","step":"Merging the parts as they come in""#)),\#(job(25, "Tidy the README", "stopped", 700, ended(650)))]}"#,
            #"{"id":"sid","name":"Sid","role":"researcher","available":true,"jobs":[\#(job(21, "Research competitor pages", "running", 840, #","parentId":20,"step":"Reading 3 of 8 pages","quietSince":"\#(ago(540))""#)),\#(job(24, "Check the DNS records", "failed", 600, ended(560) + #","error":"The registrar page did not load after three tries.""#))]}"#,
            #"{"id":"quill","name":"Quill","role":"documenter","available":true,"jobs":[\#(job(22, "Write the hero copy", "done", 830, ended(400) + #","parentId":20,"title":"Write the hero copy","summary":"Drafted three headlines.\nThe second one fits the page best and keeps the tone calm.""#)),\#(job(26, "Proofread the press note", "running", 120, #","step":"Reading a file""#))]}"#,
            #"{"id":"penny","name":"Penny","role":"finance","available":true,"jobs":[\#(job(23, "Price the hosting plans", "queued", 820, #","parentId":20,"planFirst":true,"planStatus":"awaiting","planSummary":"Compare three hosts by yearly cost""#))]}"#,
        ]
        let events = [
            #"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Launch page for Cedar","messages":6}]}"#,
            #"{"type":"helpers","apps":[],"helpers":[\#(helpers.joined(separator: ","))]}"#,
        ]
        for line in events {
            do { model.apply(try decodeEvent(line)) }
            catch { FileHandle.standardError.write(Data("gallery: workers fixture: \(error)\n".utf8)) }
        }
        let turn = Conversation.Turn(id: 1, transcript: "Ship the Cedar launch page with copy, research and hosting prices.",
                                     reply: "Kame leads it. Sid, Quill and Penny each took a part; Penny waits for you to approve a plan.", outcome: .answered)
        for theme in [AppTheme.ember, .daylight] {
            model.settings.theme = theme
            let page = VStack(alignment: .leading, spacing: Spacing.turn) {
                TurnView(turn: turn)
                ChatAgentWorkView(model: model)
            }
            .padding(24).frame(width: 760, height: 520, alignment: .top)
            .background(theme.palette.surfaceSolid.color)
            .environment(\.theme, theme.palette).environment(\.islandSnapshot, true)
            save(page, name: "51-workers-card-\(theme == .ember ? "dark" : "light")", to: directory)
        }
        // The tree on the Board: the Flow's lanes on a wide window, the stacked list on a narrow one.
        model.settings.theme = .ember; model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = .columns
        save(HelpersView(model: model).frame(width: 1300, height: 700).environment(\.islandSnapshot, true), name: "51-workers-tree-flow", to: directory)
        save(HelpersView(model: model).frame(width: 900, height: 900).environment(\.islandSnapshot, true), name: "51-workers-tree-list", to: directory)
    }
}
