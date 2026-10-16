import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-126: "@" in the chat box offers helpers, Second brain notes and a file.
struct MentionMenuTests {
    private static func helper(_ id: String, _ name: String, role: String = "researcher", available: Bool = true) -> Helper {
        Helper(id: id, name: name, available: available, app: nil, jobs: [], role: role, soulVersion: 1, soulVersions: [])
    }

    private let helpers: [Helper] = [
        helper("sid", "Sid"),
        helper("mira", "Mira", role: "coder"),
        helper("ivo", "Ivo", role: "improver"),
        helper("zed", "Zed", available: false),
    ]
    private let notes: [BrainNode] = [
        BrainNode(id: 1, title: "Trip plans", updatedAt: Date(timeIntervalSince1970: 100)),
        BrainNode(id: 2, title: "Sidewalk ideas", updatedAt: Date(timeIntervalSince1970: 300)),
        BrainNode(id: 3, title: "Kyoto trip", updatedAt: Date(timeIntervalSince1970: 200)),
        BrainNode(id: 4, title: "A memory", kind: .memory),
        BrainNode(id: 5, title: "Trip ghost", ghost: true),
        BrainNode(id: 6, title: "Chat note 2026-10-16", kind: .episode, updatedAt: Date(timeIntervalSince1970: 50)),
    ]

    @Test func theQueryIsTheAtWordAtTheEnd() {
        #expect(MentionMenu.query(in: "@") == "")
        #expect(MentionMenu.query(in: "ask @si") == "si")
        #expect(MentionMenu.query(in: "line one\n@tr") == "tr")
        #expect(MentionMenu.query(in: "@Sid ") == nil, "a space ends it")
        #expect(MentionMenu.query(in: "mail k@ex") == nil, "inside a word or an email address it is not a mention")
        #expect(MentionMenu.query(in: "no at here") == nil)
        #expect(MentionMenu.query(in: "@京都") == "京都")
    }

    @Test func helpersFirstThenNotesThenAFile() {
        let all = MentionMenu.items(query: "", helpers: helpers, notes: notes)
        #expect(all.map(\.name) == ["Sid", "Mira", "Sidewalk ideas", "Kyoto trip", "Trip plans", "Chat note 2026-10-16", "A file…"],
                "ready helpers but not the improver; pages newest first; ghosts and facts (ADR-058) left out")
        #expect(all[0].kind == .helper && all[0].detail == "Researcher")
        #expect(all[2].detail == "Note" && all[5].detail == "Conversation note" && all[5].symbol == BrainKind.episode.symbol)
    }

    @Test func matchingIsByWordStartAndCaseFree() {
        #expect(MentionMenu.items(query: "SI", helpers: helpers, notes: notes).map(\.name) == ["Sid", "Sidewalk ideas"])
        #expect(MentionMenu.items(query: "trip", helpers: helpers, notes: notes).map(\.name) == ["Trip plans", "Kyoto trip"],
                "a title starting with the word comes before one with it later")
        #expect(MentionMenu.items(query: "fi", helpers: helpers, notes: notes).map(\.name) == ["A file…"])
        #expect(MentionMenu.items(query: "xyz", helpers: helpers, notes: notes).isEmpty, "nothing matches: no menu")
        #expect(MentionMenu.items(query: "", helpers: helpers, notes: Array(repeating: notes[0], count: 20)).count == MentionMenu.limit)
    }

    @Test func choosingAHelperWritesItsName() {
        let sid = MentionMenu.items(query: "s", helpers: helpers, notes: [])[0]
        #expect(MentionMenu.completing(sid, in: "please ask @s") == "please ask @Sid ")
    }

    @Test func choosingANoteOrAFileTakesTheAtWordOut() {
        let note = MentionMenu.items(query: "kyo", helpers: [], notes: notes)[0]
        #expect(note.noteId == 3)
        #expect(MentionMenu.completing(note, in: "use @kyo") == "use ")
        let file = MentionMenu.items(query: "", helpers: [], notes: [])[0]
        #expect(file.kind == .file)
        #expect(MentionMenu.completing(file, in: "@") == "")
    }

    @Test func notesGoWithTheFilesAndCountTowardTheLimit() {
        var d = ComposerDraft()
        d.add(["/a.txt"])
        d.add(note: DraftNote(id: 3, title: "Kyoto trip"))
        d.add(note: DraftNote(id: 3, title: "Kyoto trip"))
        #expect(d.notes.count == 1, "the same note once")
        #expect(d.command(text: "plan") == .textSendFiles(text: "plan", files: ["/a.txt"], notes: [3]))
        d.add(["/b", "/c", "/d"])
        d.add(note: DraftNote(id: 4, title: "One more"))
        #expect(d.notes.count == 1 && d.notice == "A message takes 5 files at most.")
        d.remove(note: 3)
        #expect(d.notes.isEmpty)
        var only = ComposerDraft()
        only.add(note: DraftNote(id: 9, title: "x"))
        #expect(only.command(text: "") == .textSendFiles(text: "", files: [], notes: [9]), "a note alone can be sent")
        #expect(only.isEmpty == false)
    }

    @Test func theCommandLineCarriesTheNotes() {
        let line = IslandCommand.textSendFiles(text: "x", files: [], notes: [3, 7]).line
        #expect(line.contains("\"notes\":[3,7]"))
        #expect(!IslandCommand.textSendFiles(text: "x", files: ["/a"]).line.contains("notes"), "no notes, no field")
    }
}
