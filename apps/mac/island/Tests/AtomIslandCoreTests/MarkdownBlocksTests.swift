import Testing
@testable import AtomIslandCore

@Suite("A reply is split into Markdown blocks")
struct MarkdownBlocksTests {
    @Test func plainSentencesStayOneParagraphAndAreNotRich() {
        #expect(MarkdownBlocks.parse("It is sunny.\nTake a hat.") == [.paragraph("It is sunny.\nTake a hat.")])
        #expect(!MarkdownBlocks.isRich("It is sunny."))
    }

    @Test func aTableHasAHeaderAndPaddedRows() {
        let text = "Here it is.\n\n| Name | Age |\n|:--|--:|\n| Ann | 30 |\n| Bob |\n"
        #expect(MarkdownBlocks.parse(text) == [
            .paragraph("Here it is."),
            .table(header: ["Name", "Age"], rows: [["Ann", "30"], ["Bob", ""]]),
        ])
        #expect(MarkdownBlocks.isRich(text))
    }

    @Test func aPipeLineWithoutADividerIsText() {
        #expect(MarkdownBlocks.parse("| not | a table |") == [.paragraph("| not | a table |")])
    }

    @Test func listsHeadingsAndCodeBecomeBlocks() {
        let text = "# Plan\n- one\n- two\n1. first\n2. second\n```swift\nlet x = 1\n```"
        #expect(MarkdownBlocks.parse(text) == [
            .heading(level: 1, text: "Plan"),
            .list(items: ["one", "two"], number: nil),
            .list(items: ["first", "second"], number: 1),
            .code("let x = 1"),
        ])
    }

    @Test func anUnfinishedCodeBlockKeepsWhatHasArrived() {
        #expect(MarkdownBlocks.parse("```\nlet x") == [.code("let x")])
    }

    @Test func theClipboardHtmlHasARealTableWithEscapedCells() {
        let html = MarkdownBlocks.html("Done.\n\n| Name | Note |\n|---|---|\n| **Ann** | a < b |")
        #expect(html == "<p>Done.</p><table border=\"1\" cellspacing=\"0\" cellpadding=\"4\"><tr><th>Name</th><th>Note</th></tr><tr><td><strong>Ann</strong></td><td>a &lt; b</td></tr></table>")
    }
}
