import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-276: the ```ark-visual result card: what parses, what falls back to code, what Copy and VoiceOver get.
@Suite("Ark visual")
struct ArkVisualTests {
    static let sample = #"""
    {"title":"Test run","blocks":[
      {"type":"stats","items":[{"label":"Passed","value":19,"tone":"good"},{"label":"Failed","value":"2","note":"2 flaky","tone":"bad"},{"label":"Duration","value":"3.4s"}]},
      {"type":"bar","title":"Slowest tests","unit":"ms","data":[{"label":"checkout","value":1200},{"label":"login","value":340.5}]},
      {"type":"line","data":[{"label":"Mon","value":1},{"label":"Tue","value":3}]},
      {"type":"table","title":"Failures","columns":["Test","Error"],"rows":[["cart total","expected 3, got 2"],["retry",408]]}
    ]}
    """#

    @Test func aWholeCardParses() throws {
        let visual = try #require(ArkVisual.parse(Self.sample))
        #expect(visual.title == "Test run")
        #expect(visual.blocks.count == 4)
        #expect(visual.blocks[0] == .stats(title: nil, items: [
            .init(label: "Passed", value: "19", note: nil, tone: .good),
            .init(label: "Failed", value: "2", note: "2 flaky", tone: .bad),
            .init(label: "Duration", value: "3.4s", note: nil, tone: .neutral),
        ]))
        #expect(visual.blocks[1] == .bar(title: "Slowest tests", unit: "ms", data: [.init(label: "checkout", value: 1200), .init(label: "login", value: 340.5)]))
        #expect(visual.blocks[2] == .line(title: nil, unit: nil, data: [.init(label: "Mon", value: 1), .init(label: "Tue", value: 3)]))
        #expect(visual.blocks[3] == .table(title: "Failures", columns: ["Test", "Error"], rows: [["cart total", "expected 3, got 2"], ["retry", "408"]]))
    }

    @Test func limitsHold() {
        func bar(_ n: Int) -> String {
            let data = (0..<n).map { #"{"label":"L\#($0)","value":\#($0)}"# }.joined(separator: ",")
            return #"{"title":"T","blocks":[{"type":"bar","data":[\#(data)]}]}"#
        }
        #expect(ArkVisual.parse(bar(ArkVisual.maxPoints)) != nil)
        #expect(ArkVisual.parse(bar(ArkVisual.maxPoints + 1)) == nil)
        func blocks(_ n: Int) -> String {
            let one = #"{"type":"stats","items":[{"label":"A","value":"1"}]}"#
            return #"{"title":"T","blocks":[\#(Array(repeating: one, count: n).joined(separator: ","))]}"#
        }
        #expect(ArkVisual.parse(blocks(ArkVisual.maxBlocks)) != nil)
        #expect(ArkVisual.parse(blocks(ArkVisual.maxBlocks + 1)) == nil)
        func table(_ n: Int) -> String {
            #"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[\#(Array(repeating: #"["x"]"#, count: n).joined(separator: ","))]}]}"#
        }
        #expect(ArkVisual.parse(table(ArkVisual.maxRows)) != nil)
        #expect(ArkVisual.parse(table(ArkVisual.maxRows + 1)) == nil)
        let long = String(repeating: "a", count: ArkVisual.maxShort + 1)
        #expect(ArkVisual.parse(#"{"title":"\#(long)","blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#) == nil)
        // A valid card padded with trailing spaces (still valid JSON): under the byte limit it parses, past it it falls back.
        let card = #"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#
        #expect(ArkVisual.parse(card + String(repeating: " ", count: ArkVisual.maxBytes - card.utf8.count)) != nil)
        #expect(ArkVisual.parse(card + String(repeating: " ", count: ArkVisual.maxBytes - card.utf8.count + 1)) == nil)
    }

    @Test func aStatsBlockMayHaveATitle() throws {
        let visual = try #require(ArkVisual.parse(#"{"title":"T","blocks":[{"type":"stats","title":"Summary","items":[{"label":"A","value":"1"}]}]}"#))
        #expect(visual.blocks == [.stats(title: "Summary", items: [.init(label: "A", value: "1", note: nil, tone: .neutral)])])
        #expect(visual.markdown.hasPrefix("## T\n\n**Summary**\n\n| Stat | Value |"))
        #expect(visual.accessibilitySummary == "T. Summary: A 1.")
    }

    /// Keep equal to ARK_VISUAL_EXAMPLE in apps/mac/src/native-core.test.ts, which checks the prompt holds this exact text.
    static let promptExample = #"{"title":"Tests","blocks":[{"type":"stats","items":[{"label":"Failed","value":"2","tone":"bad"}]},{"type":"bar","unit":"ms","data":[{"label":"api","value":420}]}]}"#

    @Test func thePromptExampleParses() {
        #expect(ArkVisual.parse(Self.promptExample) != nil)
    }

    @Test func deepNestingFallsBackToCode() {
        let deep = String(repeating: "[", count: 200) + "1" + String(repeating: "]", count: 200)
        #expect(ArkVisual.parse(#"{"title":"T","blocks":[\#(deep)]}"#) == nil)
        #expect(ArkVisual.parse(#"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[[\#(deep)]]}]}"#) == nil)
    }

    @Test("anything outside the grammar falls back to code", arguments: [
        #"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1"#,                             // still streaming
        #"not json"#,
        #"[1,2]"#,                                                                                             // not an object
        #"{"blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#,                                  // no title
        #"{"title":"T","blocks":[]}"#,                                                                          // no blocks
        #"{"title":"T","blocks":[{"type":"pie","data":[{"label":"a","value":1}]}]}"#,                           // unknown type
        #"{"title":"T","color":"red","blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#,        // unknown key
        #"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":"1","tone":"great"}]}]}"#,       // unknown tone
        #"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":"1"}]}]}"#,                         // value as text
        #"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":true}]}]}"#,                        // value as a boolean
        #"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1},{"label":"a","value":2}]}]}"#,   // repeated label
        #"{"title":"T","blocks":[{"type":"table","columns":["A","B"],"rows":[["only one"]]}]}"#,                // short row
        #"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[[null]]}]}"#,                          // null cell
        #"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A\nB","value":"1"}]}]}"#,                   // two-line label
        #"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1e400}]}]}"#,                       // out of range
        #"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":1e400}]}]}"#,                    // out of range
        #"{"title":"T","blocks":[{"type":"stats","title":"S\nT","items":[{"label":"A","value":"1"}]}]}"#,       // two-line stats title
        "{\"title\":\"T\",\"blocks\":[{\"type\":\"stats\",\"items\":[{\"label\":\"A\",\"value\":\"\u{202E}1\"}]}]}",   // hidden control (value)
        "{\"title\":\"T\",\"blocks\":[{\"type\":\"table\",\"columns\":[\"A\"],\"rows\":[[\"x\u{202E}y\"]]}]}",        // hidden control (cell)
        "{\"title\":\"T\u{202E}\",\"blocks\":[{\"type\":\"stats\",\"items\":[{\"label\":\"A\",\"value\":\"1\"}]}]}",   // hidden control (title)
        #"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[["x\u202Ey"]]}]}"#,                   // hidden control, JSON escape
        #"<script>alert(1)</script>"#,
    ])
    func rejected(_ json: String) {
        #expect(ArkVisual.parse(json) == nil)
    }

    @Test func copyIsMarkdownTables() throws {
        let visual = try #require(ArkVisual.parse(Self.sample))
        let text = visual.markdown
        #expect(text.hasPrefix("## Test run\n\n| Stat | Value | Note |\n| --- | --- | --- |\n| Passed | 19 |  |\n| Failed | 2 | 2 flaky |"))
        #expect(text.contains("**Slowest tests**\n\n| Label | Value (ms) |\n| --- | --- |\n| checkout | 1200 |\n| login | 340.5 |"))
        #expect(text.contains("**Failures**\n\n| Test | Error |\n| --- | --- |\n| cart total | expected 3, got 2 |"))
    }

    @Test func accessibilitySummaryNamesTheShape() throws {
        let visual = try #require(ArkVisual.parse(Self.sample))
        #expect(visual.accessibilitySummary ==
            "Test run. Passed 19. Failed 2, 2 flaky. Duration 3.4s. Bar chart Slowest tests with 2 bars, largest checkout 1200 ms. " +
            "Line chart with 2 points, largest Tue 3. Table Failures with 2 rows: Test, Error.")
    }

    @Test func selectTextShowsTheCardAsTables() {
        let reply = "Done.\n\n```ark-visual\n" + Self.sample + "\n```"
        let blocks = ChatTranscript.blocks(reply)
        #expect(blocks.first == .paragraph("Done."))
        #expect(blocks.contains(.heading(level: 2, text: "Test run")))
        #expect(blocks.contains { if case .table(let header, _, _) = $0 { header == ["Test", "Error"] } else { false } })
        // An invalid card stays as its source.
        #expect(ChatTranscript.blocks("```ark-visual\n{\n```") == [.code("{", language: "ark-visual")])
    }
}
