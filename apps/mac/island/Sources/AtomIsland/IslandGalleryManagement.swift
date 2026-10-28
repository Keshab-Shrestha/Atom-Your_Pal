import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// Fictional, isolated model states: no runtime, model calls or changes to real agents.
    static func writeManagement(to directory: URL) {
        let suite = "atom.gallery.management.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        model.status.apply(.running(pid: 1))
        let fixtures = [
            #"{"type":"ready","protocol":1,"provider":"codex","model":"gpt-6-luna","microphone":"fixture","voice":false}"#,
            #"{"type":"helpers","apps":[],"usage":{"recent":[{"kind":"turn","model":"gpt-6-luna","input":120,"output":3180,"cacheRead":310000,"cacheWrite":2000},{"kind":"turn","model":"claude-sonnet-5-5","input":80,"output":2420,"cacheRead":240000,"cacheWrite":6000},{"kind":"job","model":"claude-sonnet-5-5","input":300,"output":2700,"cacheRead":150000,"cacheWrite":40000},{"kind":"turn","model":"claude-sonnet-5-5","input":150,"output":1550,"cacheRead":90000,"cacheWrite":30000},{"kind":"note","model":"claude-haiku-5-5","input":60,"output":1240,"cacheRead":70000,"cacheWrite":4000},{"kind":"turn","model":"claude-haiku-5-5","input":420,"output":0,"cacheRead":0,"cacheWrite":0}],"today":{"input":2400,"output":900,"cacheRead":190000,"cacheWrite":38000,"dollars":0.42,"runs":6},"week":{"input":19000,"output":7600,"cacheRead":1400000,"cacheWrite":290000,"dollars":3.1,"runs":41},"days":[{"day":"2026-10-21","input":3000,"output":900,"cacheRead":90000,"cacheWrite":30000,"dollars":0.3,"runs":4},{"day":"2026-10-22","input":4100,"output":2200,"cacheRead":160000,"cacheWrite":44000,"dollars":0.6,"runs":8},{"day":"2026-10-23","input":2700,"output":1200,"cacheRead":210000,"cacheWrite":31000,"dollars":0.4,"runs":6},{"day":"2026-10-24","input":3800,"output":1400,"cacheRead":260000,"cacheWrite":52000,"dollars":0.5,"runs":7},{"day":"2026-10-25","input":1200,"output":700,"cacheRead":110000,"cacheWrite":24000,"dollars":0.2,"runs":3},{"day":"2026-10-26","input":1800,"output":300,"cacheRead":380000,"cacheWrite":71000,"dollars":0.68,"runs":7},{"day":"2026-10-27","input":2400,"output":900,"cacheRead":190000,"cacheWrite":38000,"dollars":0.42,"runs":6}],"byWorker":[],"byModel":[]},"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"kit":"research","soul":{"name":"Sid","personality":"A curious researcher who cites the source.","howItWorks":"Check primary sources and explain uncertainty.","rules":"Stay within the requested scope.","lessons":""},"jobs":[{"id":71,"task":"Review the fictional Cedar launch sources","state":"running","step":"Reading the release notes","createdAt":"2026-10-27T00:00:00Z"}]},{"id":"cedar","name":"Cedar","role":"coder","available":false,"paused":true,"kit":"folders","custom":true,"soul":{"name":"Cedar","personality":"A thoughtful developer who makes focused changes.","howItWorks":"Read the project, make a small change and explain the result.","rules":"Respect the user's permissions and Git instructions.","lessons":""},"jobs":[]},{"id":"quill","name":"Quill","role":"documenter","available":true,"kit":"folders","soul":{"name":"Quill","personality":"A clear, concise writer.","howItWorks":"Write for the reader.","rules":"Use supplied facts.","lessons":""},"jobs":[]},{"id":"kame","name":"Kame","role":"coder","available":true,"kit":"folders","soul":{"name":"Kame","personality":"Patient and precise.","howItWorks":"Work in small steps.","rules":"Report checks honestly.","lessons":""},"jobs":[]},{"id":"tinker","name":"Tinker","role":"improver","available":true,"kit":"think","soul":{"name":"Tinker","personality":"A careful reviewer.","howItWorks":"Propose one improvement for review.","rules":"Do not apply unapproved changes.","lessons":""},"jobs":[]},{"id":"mira","name":"Mira","role":"designer","available":true,"kit":"folders","custom":true,"soul":{"name":"Mira","personality":"A practical designer.","howItWorks":"Make the everyday path clear.","rules":"Use existing tokens.","lessons":""},"jobs":[]}]}"#
        ]
        for fixture in fixtures {
            do { let event = try decodeEvent(fixture); model.apply(event); model.status.apply(event) }
            catch { FileHandle.standardError.write(Data("management fixture failed: \(error)\n".utf8)); return }
        }
        let date = ISO8601DateFormatter()
        model.dailyBrief.apply(BriefList(history: [
            BriefEntry(id: 10, day: "2026-10-27", createdAt: date.date(from: "2026-10-27T08:00:00Z"), lines: ["Fictional Cedar review is ready. Two task branches await your decision."]),
            BriefEntry(id: 9, day: "2026-10-26", createdAt: date.date(from: "2026-10-26T08:00:00Z"), lines: ["Cedar planning notes are saved for review.", "Confirm the release checklist before changing the schedule."]),
            BriefEntry(id: 8, day: "2026-10-25", createdAt: date.date(from: "2026-10-25T08:00:00Z"), lines: ["Fictional agenda prepared from selected sources; nothing has been sent."], isPlain: true)
        ]))
        model.helpers.apply(.git([
            GitBranch(repo: "/fictional/cedar", repoName: "Cedar", branch: "atom/task-71-source-review", task: 71, title: "Review the Cedar launch sources", base: "main", commits: [
                GitCommit(sha: "9a12b5c", subject: "Clarify source attribution in the release notes", at: date.date(from: "2026-10-27T08:30:00Z")),
                GitCommit(sha: "72b8d01", subject: "Add the reviewed launch checklist", at: date.date(from: "2026-10-26T10:00:00Z"))
            ], files: [GitFile(path: "docs/release-notes.md", added: 24, removed: 8)], remote: "https://example.com/fictional/cedar.git", pushed: .changed, baseSHA: "3de4a1b", baseSource: "saved", behind: 0),
            GitBranch(repo: "/fictional/cedar", repoName: "Cedar", branch: "atom/task-68-draft", task: 68, title: "Prepare the fictional agenda", base: "main", commits: [
                GitCommit(sha: "8d642b1", subject: "Keep the agenda as an unsent draft", at: date.date(from: "2026-10-25T09:00:00Z"))
            ], files: [GitFile(path: "agenda.md", added: 17, removed: 0)], remote: "https://example.com/fictional/cedar.git", pushed: .yes, baseSHA: "3de4a1b", baseSource: "saved")
        ]))
        if let branches = model.helpers.git {
            let additional = (1...12).map { index in
                GitBranch(repo: "/fictional/cedar", repoName: "Cedar", branch: "atom/fictional-followup-\(index)", task: 100 + index,
                          title: "Fictional saved review \(index)", base: "main", baseSource: "saved", pushAllowed: false)
            }
            model.helpers.apply(.git(branches + additional))
        }
        func capture(_ name: String, width: Double = 1280, height: Double = 900) {
            save(HelpersView(model: model).frame(width: width, height: height).environment(\.islandSnapshot, true), name: name, to: directory)
        }
        for (name, theme) in [("dark", AppTheme.void), ("light", AppTheme.daylight)] {
            model.settings.theme = theme
            model.settings.textSize = .standard
            model.windowPage = .agents; model.helpers.selectBoard(); model.boardView = .floor
            capture("44-board-" + name)
            capture("44-board-compact-" + name, width: 760, height: 1000)
            capture("45-board-fullscreen-" + name, width: 1920, height: 1080)
            model.showsAllAgents = true
            capture("44-agents-" + name, width: 1000)
            model.showsAllAgents = false
            model.windowPage = .dashboard
            capture("44-dashboard-" + name)
            capture("44-dashboard-compact-" + name, width: 760, height: 1000)
            let palette = model.settings.theme.palette
            save(GitSection(model: model, compact: true).padding(24).frame(width: 900, height: 1100, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "45-branches-" + name, to: directory)
            save(BriefHistory(model: model, initiallyExpanded: true, openEntries: [9]).padding(24).frame(width: 760, height: 480, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "45-briefs-" + name, to: directory)
            save(DashboardPanel("Token mix", detail: "No recorded tokens") {
                DashboardTokenMix(usage: TokenUsageSummary(today: TokenTotals(), week: TokenTotals()))
            }.padding(24).frame(width: 760, height: 640, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "45-usage-empty-" + name, to: directory)
            save(DashboardPanel("Token mix", detail: "Last 7 days · includes cache") {
                DashboardTokenMix(usage: TokenUsageSummary(today: TokenTotals(), week: TokenTotals(input: 9_000, output: 17_600, cacheRead: 1_400_000, cacheWrite: 290_000)))
            }.padding(24).frame(width: 420, height: 260, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "45-usage-sample-" + name, to: directory)
            let week = TokenTotals(input: 19_000, output: 7_600, cacheRead: 1_400_000, cacheWrite: 290_000, dollars: 3.1, runs: 41)
            let detailed = TokenUsageSummary(today: TokenTotals(), week: week,
                byWorker: [WorkerTokens(helper: "cedar", name: "Cedar", totals: TokenTotals(input: 700_000, output: 190_000)),
                           WorkerTokens(helper: "sid", name: "Sid", totals: TokenTotals(input: 380_000, output: 30_000)),
                           WorkerTokens(helper: "quill", name: "Quill", totals: TokenTotals(input: 240_000, output: 20_000)),
                           WorkerTokens(helper: "kame", name: "Kame", totals: TokenTotals(input: 140_000, output: 10_000))],
                byModel: [ModelTokens(model: "claude-sonnet-5-5", totals: TokenTotals(input: 1_000_000, output: 100_000)),
                          ModelTokens(model: "gpt-6-luna", totals: TokenTotals(input: 340_000, output: 40_000)),
                          ModelTokens(model: "claude-haiku-5-5", totals: TokenTotals(input: 220_000, output: 20_000))])
            save(DashboardRecentTurns(usage: detailed, plan: PlanUsage(fiveHour: 0.38, sevenDay: 0.21), mode: .usage)
                .padding(24).frame(width: 420, height: 640, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "45-usage-details-" + name, to: directory)
            model.settings.textSize = .extraLarge
            capture("44-dashboard-large-" + name, width: 760, height: 1000)
            model.windowPage = .agents; model.helpers.selectBoard(); model.settings.textSize = .standard
            model.helpers.openNewAgent()
            capture("44-add-agent-" + name, width: 1000, height: 1000)
            model.helpers.selectHelper("cedar"); model.helpers.openSoul()
            capture("44-edit-agent-" + name, width: 1000, height: 1000)
        }
    }
}
