import CoreGraphics
import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-112: the second brain's protocol, state and layout.
@Suite("Second brain (ADR-112)")
struct BrainTests {
    static let graphLine = #"""
    {"type":"brain","nodes":[
      {"id":1,"title":"Mesh Wi-Fi","kind":"note","tags":["home"],"degree":2,"updatedAt":"2026-10-10T08:00:00Z"},
      {"id":2,"title":"Penny","kind":"entity","degree":1},
      {"id":3,"title":"Router","kind":"note","ghost":true,"degree":1},
      {"id":4,"title":"A fact","kind":"memory"},
      {"title":"No id"},
      {"id":5,"kind":"note"}
    ],"edges":[{"a":1,"b":2,"auto":true},{"a":1,"b":3},{"a":"x","b":1}],"tags":[{"tag":"home","count":1},{"tag":"bad"}],"omitted":7}
    """#.replacingOccurrences(of: "\n", with: "")

    @Test func decodesTheGraphAndLeavesOutMalformedParts() throws {
        guard case .brain(let graph) = try decodeEvent(Self.graphLine) else { Issue.record("not brain"); return }
        #expect(graph.nodes.map(\.id) == [1, 2, 3, 4])
        #expect(graph.nodes[0].tags == ["home"] && graph.nodes[0].kind == .note && graph.nodes[0].updatedAt != nil)
        #expect(graph.nodes[1].kind == .entity && graph.nodes[2].ghost && graph.nodes[3].kind == .memory)
        #expect(graph.edges == [BrainEdge(a: 1, b: 2, auto: true), BrainEdge(a: 1, b: 3)])
        #expect(graph.tags == [BrainTag(tag: "home", count: 1)])
        #expect(graph.omitted == 7)
        #expect(graph.noteCount == 3, "the ghost is not a note")
    }

    @Test func aGraphWithNoFieldsReadsAsEmpty() throws {
        guard case .brain(let graph) = try decodeEvent(#"{"type":"brain"}"#) else { Issue.record("not brain"); return }
        #expect(graph == BrainGraphData())
        #expect(try decodeEvent(#"{"type":"brain"}"#).name == "brain")
    }

    @Test func anUnknownKindReadsAsANote() throws {
        guard case .brain(let graph) = try decodeEvent(#"{"type":"brain","nodes":[{"id":1,"title":"x","kind":"from-the-future"}]}"#) else { Issue.record("not brain"); return }
        #expect(graph.nodes[0].kind == .note)
    }

    @Test func decodesOneNoteWithItsLinksAndBacklinks() throws {
        let line = #"{"type":"brain.note","note":{"id":1,"title":"Mesh","body":"See [[Router]] #home","kind":"note","tags":["home"],"links":[{"id":3,"title":"Router","ghost":true}],"backlinks":[{"id":2,"title":"Penny","kind":"entity","auto":true}]}}"#
        guard case .brainNote(let note) = try decodeEvent(line) else { Issue.record("not a note"); return }
        #expect(note.body == "See [[Router]] #home" && note.isEditable)
        #expect(note.links == [BrainLink(id: 3, title: "Router", ghost: true)])
        #expect(note.backlinks == [BrainLink(id: 2, title: "Penny", kind: .entity, auto: true)])
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"brain.note"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"brain.note","note":{"id":1}}"#) }
    }

    @Test func aMirroredNoteIsNotEditableButAGhostIs() {
        #expect(!BrainNoteData(id: 1, title: "Fact", kind: .memory).isEditable)
        #expect(BrainNoteData(id: 2, title: "Ghost", kind: .note, ghost: true).isEditable)
        #expect(BrainNoteData(id: 3, title: "Mine", kind: .note).isEditable)
    }

    @Test func decodesHits() throws {
        guard case .brainHits(let query, let hits) = try decodeEvent(#"{"type":"brain.hits","query":"wifi","hits":[{"id":1,"title":"Mesh","snippet":"…wifi…"},{"title":"bad"}]}"#) else { Issue.record("not hits"); return }
        #expect(query == "wifi" && hits == [BrainHit(id: 1, title: "Mesh", kind: .note, snippet: "…wifi…")])
    }

    @Test func encodesTheCommands() throws {
        func fields(_ c: IslandCommand) throws -> [String: Any] {
            try #require(try JSONSerialization.jsonObject(with: Data(c.line.utf8)) as? [String: Any])
        }
        #expect(IslandCommand.brainGet.line == #"{"type":"brain.get"}"# + "\n")
        #expect(IslandCommand.brainNote(id: 4).line == #"{"id":4,"type":"brain.note"}"# + "\n")
        #expect(IslandCommand.brainDelete(id: 4).line == #"{"id":4,"type":"brain.delete"}"# + "\n")
        #expect(IslandCommand.brainSearch(query: "wifi").line == #"{"query":"wifi","type":"brain.search"}"# + "\n")
        let created = try fields(.brainSave(id: nil, title: "T", body: "B [[x]]"))
        #expect(created["id"] == nil && created["title"] as? String == "T" && created["body"] as? String == "B [[x]]")
        let changed = try fields(.brainSave(id: 9, title: "T", body: "B"))
        #expect(changed["id"] as? Int == 9 && changed["type"] as? String == "brain.save")
    }

    // MARK: state

    func state() -> BrainState {
        var s = BrainState()
        s.setGraph(BrainGraphData(nodes: [
            BrainNode(id: 1, title: "Mesh", kind: .note, tags: ["home"]),
            BrainNode(id: 2, title: "Penny", kind: .entity),
            BrainNode(id: 3, title: "Router", kind: .note, ghost: true),
            BrainNode(id: 4, title: "Fact", kind: .memory, tags: ["home"]),
        ], edges: [BrainEdge(a: 1, b: 2)]))
        return s
    }

    @Test func openingAsksForTheGraphOnce() {
        var s = BrainState()
        #expect(!s.opened)
        #expect(s.open() == .brainGet)
        #expect(s.opened)
    }

    @Test func selectingAsksForTheNoteAndClearingDropsIt() {
        var s = state()
        #expect(s.select(1) == .brainNote(id: 1))
        s.setNote(BrainNoteData(id: 1, title: "Mesh"))
        #expect(s.selectedId == 1 && s.note?.id == 1)
        #expect(s.select(2) == .brainNote(id: 2))
        #expect(s.note == nil, "the old note is dropped while the new one loads")
        #expect(s.select(nil) == nil)
        #expect(s.selectedId == nil && s.note == nil)
    }

    @Test func aNoteThatLeavesTheGraphIsDeselected() {
        var s = state()
        _ = s.select(2)
        s.setNote(BrainNoteData(id: 2, title: "Penny"))
        s.setGraph(BrainGraphData(nodes: [BrainNode(id: 1, title: "Mesh")]))
        #expect(s.selectedId == nil && s.note == nil)
    }

    @Test func searchTrimsClearsAndDropsAnswersToOlderWords() {
        var s = state()
        #expect(s.search("  wifi  ") == .brainSearch(query: "wifi"))
        s.setHits(query: "old", [BrainHit(id: 1, title: "Mesh")])
        #expect(s.hits == nil, "an answer to older words is dropped")
        s.setHits(query: "wifi", [BrainHit(id: 1, title: "Mesh")])
        #expect(s.matchedIds == [1])
        #expect(s.search("   ") == nil)
        #expect(s.hits == nil && s.matchedIds == nil)
        #expect(s.search(String(repeating: "a", count: 500)) == .brainSearch(query: String(repeating: "a", count: 200)))
    }

    @Test func filtersHideKindsAndTags() {
        var s = state()
        #expect(s.visibleIds == [1, 2, 3, 4])
        s.hiddenKinds = [.entity]
        #expect(s.visibleIds == [1, 3, 4])
        s.tagFilter = "home"
        #expect(s.visibleIds == [1, 4])
    }

    @Test func countsSkipGhostsAndEmptyKinds() {
        let counts = state().counts()
        #expect(counts.map(\.kind) == [.note, .memory, .entity], "the legend's order")
        #expect(counts.first { $0.kind == .note }?.count == 1)
    }

    @Test func aFailureIsShownUntilTheNextGoodAnswer() {
        var s = state()
        s.fail("A note called that exists.")
        #expect(s.error == "A note called that exists.")
        s.setGraph(BrainGraphData())
        #expect(s.error == nil)
    }

    // MARK: layout

    @Test func layoutIsDeterministicAndInsideTheSquare() {
        let ids = Array(1...12)
        let edges = (1..<12).map { ($0, $0 + 1) }
        let a = BrainLayout.solve(ids: ids, edges: edges)
        let b = BrainLayout.solve(ids: ids, edges: edges)
        #expect(a == b)
        #expect(a.count == 12)
        for p in a.values { #expect(abs(p.x) <= 1.0001 && abs(p.y) <= 1.0001) }
    }

    @Test func layoutHandlesZeroOneAndUnknownIds() {
        #expect(BrainLayout.solve(ids: [], edges: []).isEmpty)
        #expect(BrainLayout.solve(ids: [5], edges: []) == [5: .zero])
        let two = BrainLayout.solve(ids: [1, 2], edges: [(1, 2), (9, 1), (2, 2)])
        #expect(two.count == 2, "an edge to an unknown note or to itself is ignored")
    }

    @Test func linkedNotesEndCloserThanStrangers() {
        let ids = Array(1...6)
        let p = BrainLayout.solve(ids: ids, edges: [(1, 2), (2, 3), (4, 5), (5, 6)])
        func d(_ a: Int, _ b: Int) -> Double { Double(hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y)) }
        #expect(d(1, 2) < d(1, 6))
    }

    @Test func nearestFindsTheClosestNodeWithinTheRadius() {
        let positions: [Int: CGPoint] = [1: CGPoint(x: 0, y: 0), 2: CGPoint(x: 0.5, y: 0.5)]
        #expect(BrainLayout.nearest(to: CGPoint(x: 0.45, y: 0.5), in: positions, within: 0.1) == 2)
        #expect(BrainLayout.nearest(to: CGPoint(x: 0.9, y: -0.9), in: positions, within: 0.1) == nil)
    }
}
