import AppKit
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// The Second brain page: a graph of about thirty notes in clusters (home, a trip, work, tools) with one note open.
    /// Sample data only.
    static func writeBrain(to directory: URL, theme: AppTheme = .void, name: String = "17-brain") {
        let suite = "atom.gallery.brain.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette

        // (id, title, kind, tags, ghost)
        let notes: [(Int, String, BrainKind, [String], Bool)] = [
            (1, "Mesh Wi-Fi", .note, ["home"], false), (2, "Router settings", .note, ["home"], false), (3, "ISP contract", .note, ["home"], false),
            (4, "Prefers short answers", .memory, [], false), (5, "Keshab", .entity, [], false), (6, "Kyoto trip", .project, ["travel"], false),
            (7, "Flights to Osaka", .note, ["travel"], false), (8, "Hotel shortlist", .note, ["travel"], false), (9, "Suica card", .note, ["travel"], false),
            (10, "Plan a weekend in Kyoto", .chat, ["travel"], false), (11, "Weekly report", .note, ["work"], false), (12, "Haat marketplace", .project, ["work"], false),
            (13, "Seller onboarding", .note, ["work"], false), (14, "eSewa payments", .note, ["work"], false), (15, "Khalti", .note, ["work"], true),
            (16, "Penny", .entity, [], false), (17, "Budget 2026", .note, ["money"], false), (18, "Talked about the trip", .episode, ["travel"], false),
            (19, "Mac mini prices", .chat, [], false), (20, "Home office", .note, ["home"], false), (21, "Standing desk", .note, ["home"], false),
            (22, "Parakeet dictation", .note, ["tools"], false), (23, "FluidVoice", .entity, ["tools"], false), (24, "ATOM roadmap", .project, ["work"], false),
            (25, "Browser automation", .note, ["work"], false), (26, "MCP servers", .note, ["tools"], false), (27, "Claude Desktop", .entity, ["tools"], true),
            (28, "Skills", .note, ["tools"], false),
        ]
        let links: [(Int, Int)] = [
            (1, 2), (1, 3), (1, 20), (20, 21), (5, 4), (5, 6), (6, 7), (6, 8), (6, 9), (10, 6), (18, 6), (7, 17), (8, 17), (5, 11), (11, 12), (12, 13),
            (12, 14), (14, 15), (5, 16), (16, 17), (19, 5), (5, 22), (22, 23), (24, 12), (24, 25), (25, 26), (26, 27), (28, 26), (28, 24), (5, 24), (11, 24),
        ]
        var degree = [Int: Int]()
        for (a, b) in links { degree[a, default: 0] += 1; degree[b, default: 0] += 1 }
        let graph = BrainGraphData(
            nodes: notes.map { BrainNode(id: $0.0, title: $0.1, kind: $0.2, ghost: $0.4, tags: $0.3, degree: degree[$0.0] ?? 0) },
            edges: links.enumerated().map { BrainEdge(a: $0.element.0, b: $0.element.1, auto: $0.offset % 7 == 3) },
            tags: [BrainTag(tag: "work", count: 8), BrainTag(tag: "travel", count: 6), BrainTag(tag: "home", count: 5), BrainTag(tag: "tools", count: 5)])

        let m = IslandModel(settings: IslandSettings(defaults: defaults))
        m.settings.theme = theme
        m.windowPage = .brain
        m.brain.setGraph(graph)
        m.brain.setNote(BrainNoteData(
            id: 6, title: "Kyoto trip", body: "Three days in April. Fly to Osaka, then the train.\n\nSee [[Flights to Osaka]], [[Hotel shortlist]] and [[Suica card]]. #travel",
            kind: .project, tags: ["travel"],
            links: [BrainLink(id: 7, title: "Flights to Osaka"), BrainLink(id: 8, title: "Hotel shortlist"), BrainLink(id: 9, title: "Suica card")],
            backlinks: [BrainLink(id: 10, title: "Plan a weekend in Kyoto"), BrainLink(id: 5, title: "Keshab")]))

        let shape = RoundedRectangle(cornerRadius: palette.isFlat ? 24 : 16, style: .continuous)
        let page = BrainPane(model: m)
            .environment(\.islandSnapshot, true)
            .frame(width: 1000, height: 640)
            .background(palette.surfaceSolid.color)
            .themed(palette)
            .clipShape(shape)
            .overlay(shape.strokeBorder(palette.border.color, lineWidth: 1))
        save(page.padding(20).background(Color(red: 0.36, green: 0.42, blue: 0.52)), name: name, to: directory)
    }
}
