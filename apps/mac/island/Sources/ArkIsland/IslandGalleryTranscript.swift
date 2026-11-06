import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// ADR-275 (design reference: Ghostex, MIT): the worked header folded and open, the file review's diff card and the questions
    /// card, in dark and light. Fictional data and isolated preferences only; no runtime calls.
    static func writeTranscriptCards(to directory: URL) {
        let suite = "ark.gallery.transcript.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        let id = { UUID().uuidString }
        let calls = [("Read", 1200), ("Grep", 300), ("Edit", 900)].map { #"{"id":"\#(id())","tool":"\#($0.0)","state":"ok","ms":\#($0.1)}"# }
        let done = #"{"chat":"cedar","turn":"\#(id())","startedAt":"","elapsedMs":9000,"state":"completed","omitted":0,"questions":[],"calls":[\#(calls.joined(separator: ","))]}"#
        let asked = #"{"chat":"cedar","turn":"\#(id())","startedAt":"","elapsedMs":21000,"state":"working","omitted":0,"calls":[],"questions":["#
            + #"{"id":"\#(id())","prompt":"Which page should the launch link open?","choices":["The product page | Shows the walkthrough first (recommended)","The pricing page","The sign-up form | Skips the overview"],"state":"pending"},"#
            + #"{"id":"\#(id())","prompt":"Who signs the announcement?","choices":[],"state":"pending"}]}"#
        let decode = { (json: String) in try? JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8)) }
        guard let work = decode(done), let questions = decode(asked) else {
            FileHandle.standardError.write(Data("gallery: transcript fixture did not decode\n".utf8)); return
        }
        let before = "# Cedar launch\n\nDate: Thursday\nAudience: small teams\n\n## Steps\n1. Announce\n2. Walk through\n3. Follow up\n"
        let after = before.replacingOccurrences(of: "Date: Thursday\n", with: "Date: Thursday 10:00\nOwner: launch\u{200B} team\n") // a hidden character shows as a mark
            .replacingOccurrences(of: "3. Follow up\n", with: "3. Collect questions\n4. Follow up\n")
        let review = #"{"type":"approval.request","id":"r1","summary":"Change ~/Documents/Cedar/launch.md","reason":"a copy of the file is kept so you can undo it","fileReview":{"path":"/Users/example/Documents/Cedar/launch.md","before":\#(jsonString(before)),"after":\#(jsonString(after)),"token":"\#(id())"}}"#
        do { model.apply(try decodeEvent(review)) }
        catch { FileHandle.standardError.write(Data("gallery: transcript review: \(error)\n".utf8)) }
        for theme in [AppTheme.void, .daylight] {
            let palette = theme.palette
            let name = theme == .void ? "dark" : "light"
            save(VStack(alignment: .leading, spacing: 24) {
                ChatWorkView(work: work)                  // folded: an older turn
                ChatWorkView(work: work, keepOpen: true)  // open: the newest turn
            }
            .padding(24).frame(width: 720, height: 300, alignment: .topLeading)
            .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "53-worked-header-\(name)", to: directory)
            // The card as the file review shows it under Changes (the review's segmented picker and scroll view are AppKit
            // and do not render in a snapshot).
            if let file = model.approval.pending?.fileReview {
                save(FileDiffCard(files: [.init(path: file.path, diff: UnifiedDiff.make(old: file.before, new: file.after))])
                    .padding(24).frame(width: 720, height: 520, alignment: .topLeading)
                    .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "53-diff-card-\(name)", to: directory)
            }
            let first = questions.questions[0].id
            save(ChatQuestionsCard(model: model, work: questions, questions: questions.questions, preset: [first: 0])
                .padding(24).frame(width: 720, height: 640, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "53-questions-card-\(name)", to: directory)
        }
    }

    private static func jsonString(_ text: String) -> String {
        String(decoding: (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8), as: UTF8.self)
    }
}
