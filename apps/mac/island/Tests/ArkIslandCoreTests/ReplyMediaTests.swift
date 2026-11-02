import Foundation
import Testing
@testable import ArkIslandCore

/// Charts and images in replies (2026-11-02): which blocks and lines the window draws, and which stay text.
@Suite("Reply media")
struct ReplyMediaTests {
    @Test func aWholeBarChartParsesAndCopiesAsATable() throws {
        let chart = try #require(ReplyChart.parse(#"{"type":"bar","title":"Sales","labels":["Jan","Feb"],"series":[{"name":"2026","values":[12,15.5]}]}"#))
        #expect(chart.type == .bar && chart.title == "Sales" && chart.labels == ["Jan", "Feb"])
        #expect(chart.table.header == ["", "2026"])
        #expect(chart.table.rows == [["Jan", "12"], ["Feb", "15.5"]])
    }

    @Test("a chart that is cut off, miscounted or out of bounds is not drawn", arguments: [
        #"{"type":"bar","labels":["Jan","Feb"],"series":[{"name":"A","values":[1"#,                    // still streaming
        #"{"type":"bar","labels":["Jan","Feb"],"series":[{"name":"A","values":[1]}]}"#,                  // one value short
        #"{"type":"area","labels":["Jan"],"series":[{"name":"A","values":[1]}]}"#,                        // unknown type
        #"{"type":"bar","labels":[],"series":[{"name":"A","values":[]}]}"#,                               // empty
        #"{"type":"bar","labels":["Jan","Jan"],"series":[{"name":"A","values":[1,2]}]}"#,                 // repeated label
        #"{"type":"pie","labels":["A","B"],"series":[{"name":"x","values":[1,-2]}]}"#,                   // negative slice
        #"{"type":"pie","labels":["A"],"series":[{"name":"x","values":[1]},{"name":"y","values":[2]}]}"#, // pie with two series
        #"{"type":"pie","labels":["A","B"],"series":[{"name":"x","values":[0,0]}]}"#,                    // nothing to draw
    ])
    func rejected(_ json: String) {
        #expect(ReplyChart.parse(json) == nil)
    }

    @Test func tooManyLabelsAreRefused() {
        let labels = (0...ReplyChart.maxLabels).map { "\"L\($0)\"" }.joined(separator: ",")
        let values = (0...ReplyChart.maxLabels).map(String.init).joined(separator: ",")
        #expect(ReplyChart.parse(#"{"type":"line","labels":[\#(labels)],"series":[{"name":"A","values":[\#(values)]}]}"#) == nil)
    }

    @Test func fileAndWebImagesParse() {
        #expect(ReplyImage.parse("![Q3 chart](/Users/k/out/chart.png)", home: "/Users/k")?.source == .file(URL(fileURLWithPath: "/Users/k/out/chart.png")))
        #expect(ReplyImage.parse("![a](~/Pictures/cat.JPG)", home: "/Users/k")?.source == .file(URL(fileURLWithPath: "/Users/k/Pictures/cat.JPG")))
        #expect(ReplyImage.parse("![a](</Users/k/My Pics/a b.png>)", home: "/Users/k")?.source == .file(URL(fileURLWithPath: "/Users/k/My Pics/a b.png")))
        #expect(ReplyImage.parse(#"![Cat](https://example.com/cat "A cat")"#)?.source == .web(URL(string: "https://example.com/cat")!))
        #expect(ReplyImage.parse("![Cat](https://example.com/cat)")?.alt == "Cat")
    }

    @Test("only https, absolute image files, and an image alone on its line", arguments: [
        "![a](http://example.com/a.png)", "![a](data:image/png;base64,AAAA)", "![a](relative/a.png)",
        "![a](/Users/k/notes.txt)", "![a](https://user:pw@example.com/a.png)", "See ![a](/Users/k/a.png) here", "[a](/Users/k/a.png)",
    ])
    func notAnImage(_ line: String) {
        #expect(ReplyImage.parse(line, home: "/Users/k") == nil)
    }

    @Test func aParagraphSplitsIntoTextAndImages() {
        let pieces = ReplyImage.pieces("Here is the chart.\n![c](/tmp/c.png)\nIt rose in May.", home: "/Users/k")
        #expect(pieces == [.text("Here is the chart."), .image(ReplyImage(alt: "c", source: .file(URL(fileURLWithPath: "/tmp/c.png")))), .text("It rose in May.")])
        #expect(ReplyImage.pieces("No pictures here.") == nil)
    }

    @Test func aPlainDrawingPasses() throws {
        let logo = ##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g"><stop offset="0" stop-color="#f60"/></linearGradient></defs><circle cx="32" cy="32" r="28" fill="url(#g)"/><text x="32" y="38">ARK</text></svg>"##
        #expect(try #require(ReplySVG.check("\n" + logo + "\n")) == logo)
        #expect(ReplySVG.check(#"<?xml version="1.0"?>\#n"# + logo) == logo)
    }

    @Test("a drawing that can run or fetch something is refused", arguments: [
        ##"<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>"##,
        ##"<svg viewBox="0 0 1 1" onload="x()"><rect/></svg>"##,
        ##"<svg viewBox="0 0 1 1"><image href="https://e.com/a.png"/></svg>"##,
        ##"<svg viewBox="0 0 1 1"><use xlink:href="#a"/></svg>"##,
        ##"<svg viewBox="0 0 1 1"><rect fill="url(https://e.com/p#x)"/></svg>"##,
        ##"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>"##,
        ##"<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>"##,
        ##"<svg viewBox="0 0 1 1"><style>@import url(x.css);</style></svg>"##,
        ##"<svg viewBox="0 0 1 1"><rect"##,                                     // still streaming
        ##"<div>not a drawing</div>"##,
    ])
    func refusedDrawing(_ svg: String) {
        #expect(ReplySVG.check(svg) == nil)
    }

    @Test func theWholeChatCopiesAsMarkdown() {
        var chat = Conversation()
        chat.replay([ChatLine(fromUser: true, text: "Hi"), ChatLine(fromUser: false, text: "Hello.\n\n- one"), ChatLine(fromUser: true, text: "Thanks")])
        #expect(chat.markdown == "**You:** Hi\n\n**ARK:** Hello.\n\n- one\n\n**You:** Thanks")
    }

    @Test func imagesAndChartsUseTheBlockRenderer() {
        #expect(MarkdownBlocks.isRich("Look:\n![c](/tmp/c.png)"))
        #expect(MarkdownBlocks.isRich("```chart\n{}\n```"))
        #expect(!MarkdownBlocks.isRich("Plain words only."))
    }
}
