import CoreGraphics
import Foundation
import Testing
@testable import ArkIslandCore

private func agent(_ id: String, reportsTo: String? = nil, role: String = "coder") -> Helper {
    Helper(id: id, name: id.capitalized, available: true, app: nil, jobs: [], role: role, reportsTo: reportsTo)
}

struct OrgChartTests {
    @Test func levelsFollowWhoReportsToWhom() {
        let org = OrgChart(helpers: [agent("kame"), agent("lyric", reportsTo: "kame"), agent("sid"), agent("tinker", role: "improver")])
        #expect(org.agents == ["kame", "lyric", "sid"], "Tinker is not on the chart")
        #expect(OrgChart.Level.lead.rawValue == "Manager" && OrgChart.Level.worker.rawValue == "Agent", "Keshab's words")
        #expect(org.level(of: OrgChart.owner) == .owner && org.level(of: OrgChart.ark) == .ceo)
        #expect(org.level(of: "kame") == .lead && org.level(of: "lyric") == .worker && org.level(of: "sid") == .worker)
        #expect(org.children(of: OrgChart.ark) == ["kame", "sid"] && org.children(of: "kame") == ["lyric"])
        #expect(org.depth(of: "lyric") == 2)
    }

    @Test func unknownOrSelfLeadsReportToARK() {
        let org = OrgChart(helpers: [agent("a", reportsTo: "gone"), agent("b", reportsTo: "b")])
        #expect(org.parent(of: "a") == OrgChart.ark && org.parent(of: "b") == OrgChart.ark)
    }

    @Test func aCycleFromBadDataFallsBackToARK() {
        let org = OrgChart(helpers: [agent("a", reportsTo: "b"), agent("b", reportsTo: "a")])
        #expect(org.leadOf.count <= 1, "the loop is broken")
        #expect(org.agents.allSatisfy { org.depth(of: $0) <= 2 })
    }

    @Test func canReportRefusesSelfOwnPeopleAndTooDeep() {
        let org = OrgChart(helpers: [agent("a"), agent("b", reportsTo: "a"), agent("c", reportsTo: "b"), agent("d", reportsTo: "c"), agent("e")])
        #expect(org.canReport("b", to: nil) && org.canReport("b", to: OrgChart.ark))
        #expect(!org.canReport("a", to: "a"), "not itself")
        #expect(!org.canReport("a", to: "c"), "not under one of its own people")
        #expect(org.canReport("e", to: "c"), "depth 4 is allowed")
        #expect(!org.canReport("e", to: "d"), "depth 5 is not")
        #expect(!org.canReport("a", to: "e"), "a's branch is three deep: under e it would reach five")
        #expect(!org.canReport("x", to: nil), "unknown agent")
    }

    @Test func layoutCentresParentsOverChildrenWithoutOverlap() {
        let org = OrgChart(helpers: [agent("a"), agent("b", reportsTo: "a"), agent("c", reportsTo: "a"), agent("d")])
        let size = CGSize(width: 200, height: 80)
        let p = org.layout(node: size, gap: 20, levelGap: 40)
        #expect(p[OrgChart.owner]?.x == p[OrgChart.ark]?.x, "owner over ARK")
        #expect(p["a"]!.x == (p["b"]!.x + p["c"]!.x) / 2, "a lead centred over its people")
        #expect(p["b"]!.y == p["c"]!.y && p["b"]!.y > p["a"]!.y && p["a"]!.y == p["d"]!.y)
        let row = ["b", "c"].map { p[$0]!.x }.sorted()
        #expect(row[1] - row[0] >= size.width + 20, "siblings do not overlap")
        #expect(p["d"]!.x - p["a"]!.x >= size.width + 20)
    }
}
