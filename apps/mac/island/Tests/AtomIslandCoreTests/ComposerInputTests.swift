import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-125: the chat box takes several lines, pasted images, ↑ for the last message, and keeps a draft per chat.
@Suite("Composer input")
struct ComposerInputTests {
    // MARK: ↑ brings back what was sent

    @Test func upInAnEmptyBoxBringsBackTheLastMessageThenEarlierOnes() {
        var recall = MessageRecall(sent: ["first", "second", "third"])
        #expect(recall.older(current: "") == "third")
        #expect(recall.older(current: "third") == "second")
        #expect(recall.older(current: "second") == "first")
        #expect(recall.older(current: "first") == nil, "nothing older than the first")
    }

    @Test func downGoesBackTowardTheNewestAndThenToAnEmptyBox() {
        var recall = MessageRecall(sent: ["first", "second"])
        _ = recall.older(current: "")
        _ = recall.older(current: "second")
        #expect(recall.newer(current: "first") == "second")
        #expect(recall.newer(current: "second") == "", "past the newest the box is empty again")
        #expect(recall.newer(current: "") == nil, "not recalling: ↓ is the cursor's")
    }

    /// Words of your own are never replaced: ↑ moves the cursor in them.
    @Test func upDoesNothingOnceTheBoxHoldsOtherWords() {
        var recall = MessageRecall(sent: ["first", "second"])
        #expect(recall.older(current: "half typed") == nil)
        _ = recall.older(current: "")
        #expect(recall.older(current: "second, edited") == nil, "an edited recall is the user's now")
        #expect(recall.newer(current: "second, edited") == nil)
    }

    @Test func blankAndRepeatedMessagesAreSkipped() {
        var recall = MessageRecall(sent: ["a", "  ", "b", "b", "\n"])
        #expect(recall.older(current: "") == "b")
        #expect(recall.older(current: "b") == "a")
        #expect(MessageRecall(sent: []).entries.isEmpty)
    }

    @Test func recallKeepsTheLast50() {
        let recall = MessageRecall(sent: (1...80).map(String.init))
        #expect(recall.entries.count == MessageRecall.limit)
        #expect(recall.entries.last == "80")
        #expect(recall.entries.first == "31")
    }

    // MARK: a draft for each chat

    @Test func switchingChatsKeepsEachChatsWordsAndFiles() {
        var drafts = ChatDrafts()
        var files = ComposerDraft()
        files.add(["/tmp/a.png"])
        let toB = drafts.switching(from: "a", to: "b", text: "half a thought", files: files)
        #expect(toB.text == "" && toB.files.files.isEmpty, "a new chat starts empty")
        let backToA = drafts.switching(from: "b", to: "a", text: "for b", files: ComposerDraft())
        #expect(backToA.text == "half a thought")
        #expect(backToA.files.files.map(\.path) == ["/tmp/a.png"])
        #expect(drafts.switching(from: "a", to: "b", text: "", files: ComposerDraft()).text == "for b")
    }

    @Test func anEmptyDraftIsForgotten() {
        var drafts = ChatDrafts()
        _ = drafts.switching(from: "a", to: "b", text: "  ", files: ComposerDraft())
        #expect(drafts.isEmpty, "whitespace with no files is not a draft")
        _ = drafts.switching(from: "b", to: "a", text: "x", files: ComposerDraft())
        _ = drafts.switching(from: "a", to: "b", text: "", files: ComposerDraft())
        #expect(drafts.text(for: "b").isEmpty)
        #expect(drafts.text(for: "a").isEmpty, "a's draft was taken out when a opened, and a left empty")
    }

    @Test func theSameChatChangesNothing() {
        var drafts = ChatDrafts()
        let same = drafts.switching(from: "a", to: "a", text: "keep", files: ComposerDraft())
        #expect(same.text == "keep")
        #expect(drafts.isEmpty)
    }

    /// A new chat has no id ("") until its first answer saves it. Words typed meanwhile stay in the box when the id
    /// arrives; they are not put away under "".
    @Test func aNewChatGettingItsIdKeepsTheBox() {
        var drafts = ChatDrafts()
        let saved = drafts.switching(from: "", to: "s1", text: "next question", files: ComposerDraft())
        #expect(saved.text == "next question")
        #expect(drafts.isEmpty)
        // Leaving a chat for a new one still puts its words away.
        let fresh = drafts.switching(from: "s1", to: "", text: "for s1", files: ComposerDraft())
        #expect(fresh.text.isEmpty)
        #expect(drafts.text(for: "s1") == "for s1")
    }

    /// Drafts are capped so a long session cannot grow without end.
    @Test func atMost20ChatsKeepADraft() {
        var drafts = ChatDrafts()
        for i in 0..<30 { _ = drafts.switching(from: "c\(i)", to: "c\(i + 1)", text: "draft \(i)", files: ComposerDraft()) }
        #expect(drafts.count == ChatDrafts.limit)
        #expect(drafts.text(for: "c29") == "draft 29")
        #expect(drafts.text(for: "c0").isEmpty, "the oldest went first")
    }

    // MARK: pasted images

    @Test func aPastedImageGetsADatedNameWithNoColons() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: 16, hour: 23, minute: 5, second: 9))!
        let name = PastedImage.fileName(at: date, calendar: calendar)
        #expect(name == "Pasted image 2026-10-16 at 23.05.09.png")
        #expect(!name.contains(":") && !name.contains("/"))
        #expect(PastedImage.fileName(at: date, ext: "jpg", calendar: calendar).hasSuffix("09.jpg"))
    }

    /// The runtime takes 10 MB a file: a big Retina screenshot goes as JPEG instead of being refused.
    @Test func aPNGTooBigForTheRuntimeGoesAsJPEG() {
        #expect(PastedImage.maxBytes == 10 * 1024 * 1024)
        #expect(PastedImage.encoding(pngBytes: 2_000_000) == .png)
        #expect(PastedImage.encoding(pngBytes: PastedImage.maxBytes) == .png)
        #expect(PastedImage.encoding(pngBytes: PastedImage.maxBytes + 1) == .jpeg)
    }

    /// Pasted files are copied into the chat when sent; the temp copies older than a day are removed.
    @Test func oldPastedFilesAreRemoved() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("atom-pasted-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let old = dir.appendingPathComponent("old.png"), fresh = dir.appendingPathComponent("fresh.png")
        try Data([1]).write(to: old)
        try Data([1]).write(to: fresh)
        let now = Date()
        try FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-90_000)], ofItemAtPath: old.path)
        PastedImage.removeOld(in: dir, now: now)
        #expect(!FileManager.default.fileExists(atPath: old.path))
        #expect(FileManager.default.fileExists(atPath: fresh.path))
    }

    @Test func pastedImagesGoInTheTempFolderNotInLibrary() {
        let dir = PastedImage.directory
        #expect(dir.path.hasPrefix(FileManager.default.temporaryDirectory.path))
        #expect(!dir.path.contains("/Library/"), "the runtime refuses parts of ~/Library")
    }

    /// What ⌘V does: files win over the name text Finder puts with them; text pastes as text; a bare image attaches.
    @Test func pasteChoosesFilesThenTextThenImage() {
        #expect(PasteChoice.choose(fileURLs: ["/tmp/a.pdf"], hasText: true, hasImage: false) == .files(["/tmp/a.pdf"]))
        #expect(PasteChoice.choose(fileURLs: [], hasText: true, hasImage: true) == .text, "text with an image (a web selection) pastes as text")
        #expect(PasteChoice.choose(fileURLs: [], hasText: false, hasImage: true) == .image)
        #expect(PasteChoice.choose(fileURLs: [], hasText: false, hasImage: false) == .text, "nothing usable: the field does its normal paste")
    }

    // MARK: several lines

    @Test func theBoxGrowsToEightLinesThenScrolls() {
        #expect(ComposerLines.range == 1...8)
    }

    @Test func sendingKeepsTheLineBreaksInside() throws {
        let command = try #require(ComposerDraft().command(text: "  line one\nline two\n\n"))
        #expect(command == .textSend("line one\nline two"))
    }
}
