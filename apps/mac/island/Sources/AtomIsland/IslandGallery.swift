import AppKit
import SwiftUI
import AtomIslandCore

/// Development only (`ATOM_ISLAND_GALLERY=<dir>`): renders the island's views with sample data to PNG files,
/// then exits. Starts no runtime, no microphone and no network; settings go to a throwaway defaults suite.
@MainActor
enum IslandGallery {
    /// The width a single card (Settings' now card, a setup card) is drawn at: the old panel's width.
    private static let cardWidth: CGFloat = 380

    static func render(to directory: URL) {
        let suite = "atom.gallery.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        // ADR-091: the app's icon alone (scripts/make-icon.sh).
        if AtomEnv.read("ATOM_ISLAND_GALLERY_ONLY") == "icon" {
            AppIconArt.render(to: directory)
            return
        }

        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        let lines = [
            #"{"type":"ready","protocol":1,"provider":"claude-plan","model":"claude-sonnet-5-5","microphone":"Mac mini Microphone","voice":true}"#,
            #"{"type":"info","provider":"claude-plan","model":"claude-sonnet-5-5","providers":[{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]}]}"#,
            #"{"type":"state","state":"listening"}"#,
            #"{"type":"state","state":"transcribing"}"#,
            #"{"type":"transcript","text":"What's on my calendar this afternoon?"}"#,
            #"{"type":"state","state":"thinking"}"#,
            #"{"type":"reply","text":"You have a design review at 3 and a call with Aiko at 4:30. Nothing after that."}"#,
            #"{"type":"state","state":"speaking"}"#,
            #"{"type":"turn.complete","speechMs":2400,"transcriptionMs":610,"modelMs":1840,"firstSoundMs":2710}"#,
            #"{"type":"state","state":"idle"}"#,
            #"{"type":"state","state":"listening"}"#,
            #"{"type":"state","state":"transcribing"}"#,
            #"{"type":"transcript","text":"Remind me to send the deck before the call."}"#,
            #"{"type":"state","state":"thinking"}"#,
            #"{"type":"reply","text":"I can't set reminders yet, but I'll be able to once Mac tools arrive. Want me to draft the email instead?"}"#,
            #"{"type":"state","state":"speaking"}"#,
            #"{"type":"turn.complete","speechMs":2100,"transcriptionMs":540,"modelMs":2260,"firstSoundMs":3010}"#,
            #"{"type":"state","state":"idle"}"#,
        ]
        model.status.apply(.running(pid: 1))
        for line in lines {
            guard let event = try? decodeEvent(line) else {
                FileHandle.standardError.write(Data("gallery: could not decode \(line)\n".utf8))
                continue
            }
            model.status.apply(event)
            model.apply(event)
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // ADR-093: the drop-down panel is gone (since ADR-089 "open" goes to the ATOM window, drawn in sheet 13); the
        // compact card under the menu-bar icon (Pal off) is what the island itself still shows.
        write(model, size: IslandMetrics().compact, name: "1-compact", to: directory)
        // ADR-084: the now card with "Last turn" opened to every stage, and with the plan meters and a problem.
        let palette = model.settings.theme.palette
        let nowCard = NowCard(model: model, timingsOpen: true)
            .padding(Spacing.panel)
            .frame(width: cardWidth)
            .background(palette.surfaceFill(solid: true))
            .themed(palette)
        save(nowCard, name: "2-settings-now-last-turn", to: directory)
        // ADR-086: Void is the default; each sheet that changed with it is also drawn in Lantern ("-lantern").
        writePals(to: directory)
        writePet(to: directory)
        writePet(to: directory, theme: .lantern, name: "5-pal-moods-lantern")
        writeBubbles(to: directory)
        writeApproval(to: directory)
        writeThemes(to: directory)
        writeSetup(to: directory)
        writeHelpers(to: directory)
        writeHelpers(to: directory, theme: .lantern, name: "13-helpers-lantern")
        writeHelpers(to: directory, theme: .daylight, name: "13-helpers-daylight") // 2026-10-15: the light theme
        writeMenuBar(to: directory)
        writeMenuBar(to: directory, flat: false, name: "15-menu-bar-item-lantern")
        writeChatDesign(to: directory)
        writeModelPicker(to: directory)
        writeGitWorkspace(to: directory)
        writeProjectSources(to: directory)
        writeAdaptation(to: directory)
        writeStudio(to: directory)
        writeWorkspace(to: directory)
        writeProjects(to: directory)
        writeProjects(to: directory, theme: .lantern, name: "16-projects-lantern")
        writeBrain(to: directory)
        writeMcpPaste(to: directory)
        writeStates(to: directory)
        writeModelPage(to: directory)
        writeSlashPicker(to: directory)
        writeMentionPicker(to: directory)
        writeSidebarHidden(to: directory)
        writeDesignPage(to: directory)
        writeBrain(to: directory, theme: .daylight, name: "17-brain-daylight")
        writeBrain(to: directory, theme: .lantern, name: "17-brain-lantern")
    }

    /// ADR-081: the ATOM window with Sid running one job and done with another, the rest of the team (Task 3.3); Sid's
    /// report open; and the job list in the light Warm theme. ADR-083: Sid's model picker (Laya, then pinned), the
    /// large-model switch (on, then off) and each job's model.
    private static func writeHelpers(to directory: URL, theme: AppTheme = .void, name: String = "13-helpers") {
        let suite = "atom.gallery.helpers.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let iso = ISO8601DateFormatter()
        let ago = { (minutes: Double) in iso.string(from: Date().addingTimeInterval(-minutes * 60)) }
        // ADR-083: the plan's models, the large-model switch, Sid's pin (null: Laya chooses) and each job's model.
        let models = #"[{"id":"claude-haiku-4-5","name":"Claude Haiku 4.5","tier":"small"},{"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5","tier":"medium"},{"id":"claude-opus-5-5","name":"Claude Opus 5.5","tier":"large"}]"#
        // Task 3.3: the team of seven, with Sid's soul (version 2 carries a lesson).
        let sidSoul = #"{"name":"Sid","personality":"Curious and thorough. Always cites sources.","howItWorks":"Searches more than once, reads several good pages, compares what they say, and prefers primary and reputable sources.","rules":"Say plainly when sources disagree or when something could not be confirmed.","lessons":"Give at least three sources; two reports had only one."}"#
        // Task 3.4: Hana's guide waits for Sid's running research.
        let hanaJob = #"{"id":5,"task":"Write a one-page guide from Sid's IPv6 research","state":"queued","createdAt":"\#(ago(3))","blockedBy":[2],"waitingFor":[2],"comments":1}"#
        // ADR-095: Kame builds a dark mode; Quill's plan waits for Keshab.
        let kameJob = #"{"id":6,"task":"Add a dark mode toggle to the site","state":"running","createdAt":"\#(ago(6))","step":"Writing the tests"}"#
        let quillJob = #"{"id":7,"task":"Write the release notes","state":"queued","createdAt":"\#(ago(2))","planFirst":true,"planStatus":"awaiting","planSummary":"Three sections: new, fixed, known issues."}"#
        // ADR-095: a manager team: Research (plans and reviews) with four agents, Coding with three, Writing with two.
        let team = [("kame", "Kame", true, "coder", "coding"), ("puff", "Puff", true, "designer", "coding"), ("bo", "Bo", true, "coder", "coding"),
                    ("quill", "Quill", true, "documenter", "writing"), ("rumi", "Rumi", true, "travel planner", "writing"),
                    ("penny", "Penny", true, "financial adviser", "research"), ("hana", "Hana", true, "hr", "research"), ("ada", "Ada", true, "researcher", "research"),
                    ("tinker", "Tinker", false, "improver", "")]
            .map { id, name, available, role, manager in
                let jobs = id == "hana" ? hanaJob : id == "kame" ? kameJob : id == "quill" ? quillJob : ""
                return #"{"id":"\#(id)","name":"\#(name)","available":\#(available),"app":null,"role":"\#(role)","soul":{"name":"\#(name)","personality":"…","howItWorks":"","rules":"","lessons":""},"soulVersion":1,"soulVersions":[{"version":1,"createdAt":"\#(ago(3000))"}],"custom":\#(id == "rumi" || id == "bo" || id == "ada"),"kit":"\#(id == "rumi" ? "think" : id == "kame" || id == "puff" || id == "bo" ? "folders" : "research")","grants":\#(id == "kame" ? #"["\#(NSHomeDirectory())/Developer/zeno"]"# : "[]"),\#(manager.isEmpty ? "" : #""manager":"\#(manager)","#)"jobs":[\#(jobs)]}"#
            }.joined(separator: ",")
        let managers = [("coding", "Coding", "group", #"["kame","puff","bo"]"#), ("research", "Research", "plan", #"["sid","penny","hana","ada"]"#), ("writing", "Writing", "group", #"["quill","rumi"]"#)]
            .map { id, name, mode, agents in
                #"{"id":"\#(id)","name":"\#(name)","mode":"\#(mode)","soul":{"name":"\#(name)","personality":"Runs ATOM's \#(name) team: calm, fair and specific.","howItWorks":"","rules":"","lessons":""},"soulVersion":1,"agents":\#(agents),"jobs":[]}"#
            }.joined(separator: ",")
        func helpers(pinned: String, allowLarge: Bool, failed: Bool = false) -> String { #"{"type":"helpers","apps":["Brave Browser","Notes","Safari"],"teamTasks":[{"id":1,"task":"Compare three note-taking apps for a small team","createdAt":"\#(ago(25))"},{"id":2,"task":"Find the current mortgage rates in Japan","role":"financial adviser","createdAt":"\#(ago(190))"}],"allowLarge":\#(allowLarge),"models":\#(models),"usage":{"today":{"input":18000,"output":7000,"cacheRead":140000,"cacheWrite":5000,"dollars":0.71,"runs":9},"week":{"input":80000,"output":31500,"cacheRead":610000,"cacheWrite":21000,"dollars":3.15,"runs":39},"days":[{"day":"2026-10-05","input":9000,"output":3000,"cacheRead":60000,"cacheWrite":2000,"dollars":0.31,"runs":4},{"day":"2026-10-06","input":0,"output":0,"cacheRead":0,"cacheWrite":0,"dollars":0,"runs":0},{"day":"2026-10-07","input":15000,"output":6000,"cacheRead":110000,"cacheWrite":4000,"dollars":0.62,"runs":7},{"day":"2026-10-08","input":4000,"output":1500,"cacheRead":30000,"cacheWrite":1000,"dollars":0.12,"runs":2},{"day":"2026-10-09","input":22000,"output":9000,"cacheRead":180000,"cacheWrite":6000,"dollars":0.95,"runs":11},{"day":"2026-10-10","input":12000,"output":5000,"cacheRead":90000,"cacheWrite":3000,"dollars":0.44,"runs":6},{"day":"2026-10-11","input":18000,"output":7000,"cacheRead":140000,"cacheWrite":5000,"dollars":0.71,"runs":9}],"byWorker":[{"helper":"sid","name":"Sid","input":40000,"output":15000,"cacheRead":320000,"cacheWrite":9000,"dollars":1.6,"runs":14},{"helper":null,"name":"ATOM chat","input":20000,"output":9000,"cacheRead":160000,"cacheWrite":6000,"dollars":0.8,"runs":19},{"helper":"quill","name":"Quill","input":20000,"output":7500,"cacheRead":130000,"cacheWrite":6000,"dollars":0.75,"runs":6}],"byModel":[{"model":"claude-sonnet-5-5","input":60000,"output":24000,"cacheRead":480000,"cacheWrite":16000,"dollars":2.7,"runs":22},{"model":"claude-haiku-5-5","input":20000,"output":7500,"cacheRead":130000,"cacheWrite":5000,"dollars":0.45,"runs":17}]},"skills":[{"name":"compare-laptops","description":"Use when comparing laptops for a budget.","source":"zeno"},{"name":"council","description":"Four voices for hard calls.","source":"yours"},{"name":"pdf","description":"Read and write PDFs.","source":"yours"}],"skillDrafts":[{"id":1,"jobId":1,"helper":"sid","name":"networking-basics","description":"Use when explaining networking to a beginner.","preview":"1. Start from what the person already knows.\n2. Follow one request from the Mac to a website and back.","state":"pending","createdAt":"2026-10-12T00:00:00Z"}],"skillEdits":[{"id":1,"skill":"compare-laptops","jobId":4,"reason":"It compared only two models; three give a real choice.","before":"2. Compare two models.","after":"2. Compare at least three models.","state":"pending","createdAt":"2026-10-12T00:00:00Z"}],"mcp":[{"id":1,"name":"notes","kind":"command","command":"/usr/local/bin/notes-mcp","args":["--stdio"],"transport":"http","envKeys":["NOTES_TOKEN"],"headerKeys":[],"enabled":true,"trusted":false,"workers":["sid","quill"],"tools":["search","add_note","list"],"testedAt":"2026-10-11T00:00:00Z"},{"id":2,"name":"linear","kind":"url","url":"https://mcp.linear.app/mcp","args":[],"transport":"http","envKeys":[],"headerKeys":["Authorization"],"enabled":false,"trusted":false,"workers":[],"tools":[]}],"helpers":[{"id":"sid","name":"Sid","available":true,"app":"Brave Browser","role":"researcher","routines":[{"id":1,"task":"Summarise networking news","when":"Every day at 8:00 AM","lastAt":"\#(ago(120))","nextAt":"\#(ago(-1320))"},{"id":2,"task":"Check router firmware news","when":"Every Monday at 9:00 AM","paused":true}],"wakeUp":{"every":"1h","when":"Every hour","lastAt":"\#(ago(48))","nextAt":"\#(ago(-12))"},"soul":\#(sidSoul),"soulVersion":2,"soulVersions":[{"version":2,"createdAt":"\#(ago(30))"},{"version":1,"createdAt":"\#(ago(3000))"}],"pinnedModel":\#(pinned),"manager":"research","jobs":[\#(failed ? #"{"id":4,"task":"Compare the reviews of the new Mac mini","state":"failed","createdAt":"\#(ago(2))","endedAt":"\#(ago(1))","error":"The review pages would not load"},"# : ""){"id":3,"task":"What year was TCP/IP adopted by ARPANET?","state":"queued","createdAt":"\#(ago(1))","held":"Interrupted — waiting for you.","interrupted":true},{"id":2,"task":"Research how IPv6 is rolled out in home routers","state":"running","createdAt":"\#(ago(4))","step":"Reading 3 of 8 pages","model":"claude-sonnet-4-5","modelReason":"Laya: moderate"},{"id":1,"task":"Research networking basics for a beginner","state":"done","createdAt":"\#(ago(52))","endedAt":"\#(ago(41))","title":"Networking basics","summary":"How data finds its way from your Mac to a website and back.","model":"claude-haiku-4-5","modelReason":"Laya: easy"}]},\#(team)],"managers":[\#(managers)]}"# }
        let report = #"{"type":"report","id":1,"title":"Networking basics","summary":"How data finds its way from your Mac to a website and back.","body":"Every device on a network has an address. Your router hands one to your Mac, and translates between your home network and the internet.\n\nData travels in small packets. Each packet carries where it is going, and routers along the way pass it on, one hop at a time.\n\nNames like apple.com are turned into addresses by DNS before any packet is sent.","sources":[{"title":"How the Internet works","url":"https://developer.mozilla.org/en-US/docs/Learn/Common_questions/Web_mechanics/How_does_the_Internet_work"},{"title":"Internet Protocol (RFC 791)","url":"https://www.rfc-editor.org/rfc/rfc791"}]}"#
        func model(_ theme: AppTheme, pinned: String = "null", allowLarge: Bool = true, failed: Bool = false) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            m.windowPage = .agents // the team's pages, unless a window asks for Chat or Settings
            m.chats = ChatList(chats: [ // ADR-091
                ChatInfo(id: "c1", title: "Plan a weekend in Kyoto", updatedAt: Date().addingTimeInterval(-300), messages: 6),
                ChatInfo(id: "c2", title: "What's on my calendar tomorrow?", updatedAt: Date().addingTimeInterval(-7200), messages: 2),
                ChatInfo(id: "c3", title: "Compare Mac mini prices", updatedAt: Date().addingTimeInterval(-86_400 * 2), messages: 4),
            ], current: "c1")
            do { m.apply(try decodeEvent(helpers(pinned: pinned, allowLarge: allowLarge, failed: failed))) } catch {
                FileHandle.standardError.write(Data("gallery: could not decode helpers: \(error)\n".utf8))
            }
            return m
        }
        func window(_ title: String, _ m: IslandModel) -> some View {
            // Void's windows are 24 with a graphite hairline (ADR-086); the real window's corners are the system's.
            let flat = m.settings.theme.palette.isFlat
            let shape = RoundedRectangle(cornerRadius: flat ? 24 : 16, style: .continuous)
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                frozen(HelpersView(model: m).environment(\.islandSnapshot, true).frame(width: 720, height: 520))
                    // The window's own buttons, which only the window server draws, over the clear title bar.
                    .overlay(alignment: .topLeading) {
                        HStack(spacing: 8) {
                            ForEach([0xFF5F57, 0xFEBC2E, 0x28C840] as [UInt32], id: \.self) { hex in
                                Circle().fill(RGBA(hex: hex).color).frame(width: 12, height: 12)
                            }
                        }
                        .padding(.leading, 16).padding(.top, 16)
                    }
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(flat ? m.settings.theme.palette.border.color : Color.white.opacity(0.1), lineWidth: flat ? 1 : 0.5))
            }
        }
        let souled = model(theme)
        souled.helpers.openSoul()
        let reading = model(theme)
        _ = reading.helpers.openThread(1)
        let reportObject = report.replacingOccurrences(of: #"{"type":"report","id":1,"#, with: "{")
        let thread = #"{"type":"thread","id":1,"comments":[{"id":1,"text":"Keep it short, for a beginner.","createdAt":"\#(ago(53))"}],"activity":[{"kind":"created","at":"\#(ago(53))"},{"kind":"commented","at":"\#(ago(53))"},{"kind":"running","at":"\#(ago(52))"},{"kind":"done","at":"\#(ago(41))"}],"report":\#(reportObject),"goal":{"id":1,"text":"networking guide for a beginner","ended":false,"tasks":[1,5]}}"#
        do { reading.apply(try decodeEvent(thread)) } catch { FileHandle.standardError.write(Data("gallery: thread: \(error)\n".utf8)) }
        let boarded = model(theme)
        boarded.helpers.selectBoard()
        let kamed = model(theme)
        kamed.helpers.selectHelper("kame")
        let creating = model(theme)
        creating.helpers.openNewAgent()
        creating.windowPage = .agents
        let chatting = model(theme)
        chatting.windowPage = .chat
        let setting = model(theme)
        setting.windowPage = .settings
        let overviewing = model(theme)
        overviewing.helpers.selectBoard()
        overviewing.boardView = .overview
        let inboxing = model(theme, failed: true)
        inboxing.helpers.selectBoard() // Needs you is a Board view now
        inboxing.boardView = .needsYou
        let plugging = model(theme)
        plugging.windowPage = .plugins
        let scheduling = model(theme) // ADR-094
        scheduling.windowPage = .scheduled
        // ADR-094: fifty agents: fourteen at work, three failed, five used in the last hour, the rest idle. The Board shows
        // twelve chips and All agents; the floor twelve seats, ten in the lounge and a "+N" sign for each of the rest.
        let crowdNames = ["Ada", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lu", "Max", "Nia", "Oz", "Pia", "Quin",
                          "Ray", "Sol", "Tia", "Uma", "Vic", "Wren", "Xia", "Yuri", "Zed", "Abe", "Bea", "Cal", "Dot", "Ed", "Flo", "Gil",
                          "Hope", "Ike", "Jay", "Kit", "Lin", "Mo", "Ned", "Ola", "Pip", "Rex", "Sky", "Ted", "Una", "Val", "Wes", "Yan", "Zoe"]
        let crowdRoles = ["researcher", "coder", "designer", "documenter", "financial adviser", "hr", "travel planner", "writer"]
        let crowdSteps = ["Reading 3 of 8 pages", "Writing the tests", "Drawing the icons", "Checking the numbers", "Comparing flights"]
        let crowdHelpers = crowdNames.enumerated().map { i, name -> String in
            let job = i < 14 ? #"{"id":\#(1000 + i),"task":"Task \#(i)","state":"running","createdAt":"\#(ago(Double(i * 3 + 1)))","step":"\#(crowdSteps[i % crowdSteps.count])"}"#
                : i < 17 ? #"{"id":\#(1000 + i),"task":"Task \#(i)","state":"failed","createdAt":"\#(ago(90))","endedAt":"\#(ago(80))","error":"The page would not load"}"#
                : i < 22 ? #"{"id":\#(1000 + i),"task":"Task \#(i)","state":"done","createdAt":"\#(ago(Double(i * 2 + 10)))","endedAt":"\#(ago(Double(i * 2)))","title":"Report \#(i)"}"#
                : ""
            return #"{"id":"\#(name.lowercased())","name":"\#(name)","available":true,"app":null,"role":"\#(crowdRoles[i % crowdRoles.count])","jobs":[\#(job)]}"#
        }.joined(separator: ",")
        func crowd(listOpen: Bool) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            m.windowPage = .agents
            do { m.apply(try decodeEvent(#"{"type":"helpers","apps":[],"helpers":[\#(crowdHelpers)]}"#)) } catch {
                FileHandle.standardError.write(Data("gallery: could not decode the crowd: \(error)\n".utf8))
            }
            m.helpers.selectBoard()
            m.showsAllAgents = listOpen
            return m
        }
        let crowded = crowd(listOpen: false)
        let dashing = model(theme)
        dashing.windowPage = .dashboard
        dashing.planUsage = PlanUsage(fiveHour: 0.62, sevenDay: 0.31)
        // Token cost, job 4: input + output first, the cache counts apart, and the newest calls with their split.
        // Keep weekday labels stable across runs and time zones, like the rest of this sample data.
        var dashboardCalendar = Calendar(identifier: .gregorian)
        dashboardCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let dashboardDay = dashboardCalendar.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 12))!
        let day = { (back: Int, io: (Int, Int), write: Int, read: Int) -> String in
            let d = dashboardCalendar.date(byAdding: .day, value: -back, to: dashboardDay)!
            let f = DateFormatter(); f.calendar = dashboardCalendar; f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = dashboardCalendar.timeZone; f.dateFormat = "yyyy-MM-dd"
            return #"{"day":"\#(f.string(from: d))","input":\#(io.0),"output":\#(io.1),"cacheRead":\#(read),"cacheWrite":\#(write),"dollars":0.4,"runs":6}"#
        }
        let days = (0..<7).reversed().map { day($0, (2400 + $0 * 310, 900 + $0 * 120), 38_000 + $0 * 2_000, 190_000 + $0 * 9_000) }.joined(separator: ",")
        let usageJSON = #"{"type":"helpers","apps":[],"usage":{"today":{"input":2400,"output":900,"cacheRead":190000,"cacheWrite":38000,"dollars":0.42,"runs":6},"week":{"input":19000,"output":7600,"cacheRead":1400000,"cacheWrite":290000,"dollars":3.1,"runs":41},"days":[\#(days)],"byWorker":[{"helper":null,"name":"ATOM chat","input":9000,"output":4000,"cacheRead":900000,"cacheWrite":180000,"dollars":1.9,"runs":30},{"helper":"sid","name":"Sid","input":10000,"output":3600,"cacheRead":500000,"cacheWrite":110000,"dollars":1.2,"runs":11}],"byModel":[{"model":"claude-opus-5-5","input":9000,"output":4000,"cacheRead":900000,"cacheWrite":180000,"dollars":1.9,"runs":30},{"model":"claude-haiku-4-5-20251001","input":10000,"output":3600,"cacheRead":500000,"cacheWrite":110000,"dollars":1.2,"runs":11}],"chatCacheCold":false,"recent":[{"at":"2026-10-13T00:41:30.355Z","kind":"note","model":"claude-haiku-4-5-20251001","input":796,"output":5,"cacheRead":0,"cacheWrite":0,"gapMs":3100},{"at":"2026-10-13T00:41:27.248Z","kind":"turn","model":"claude-haiku-4-5-20251001","input":18,"output":414,"cacheRead":30109,"cacheWrite":12874,"gapMs":42000},{"at":"2026-10-12T23:13:40.905Z","kind":"turn","model":"claude-haiku-4-5-20251001","input":3,"output":15,"cacheRead":0,"cacheWrite":6149}]},"helpers":[]}"#
        if let e = try? decodeEvent(usageJSON) { dashing.apply(e) } else { FileHandle.standardError.write(Data("gallery: could not decode the dashboard usage\n".utf8)) }
        dashing.helpers.apply(.git([GitBranch(repo: "/Users/k/Developer/site", repoName: "site", branch: "zeno/task-12", task: 12, title: "Add a dark mode toggle",
                                              base: "origin/main", commits: [GitCommit(sha: "3f9c2a1", subject: "ATOM task 12: Add a dark mode toggle", at: nil)],
                                              files: [GitFile(path: "src/theme.css", added: 42, removed: 3), GitFile(path: "src/App.tsx", added: 18, removed: 6)],
                                              remote: "git@github.com:keshab/site.git", pushed: .no)]))
        let sheet = VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                window("Helpers: Sid's model chosen by Laya, jobs show their model", model(theme))
                window("A task's thread: report, the whole goal, notes, activity (Tasks 3.4, 3.5)", reading)
            }
            HStack(alignment: .top, spacing: 18) {
                let other: AppTheme = theme == .void ? .void : .warm
                window("\(other == .warm ? "Warm (light)" : other.title): Sid pinned to Sonnet, large model off, a failed job", model(other, pinned: #""claude-sonnet-4-5""#, allowLarge: false, failed: true))
                window("Sid's soul (Task 3.3)", souled)
            }
            HStack(alignment: .top, spacing: 18) {
                window("The board: Managers' chips; a held task; Hana waits for Sid (ADR-095)", boarded)
                window("Kame: a granted folder, its own branch, its manager (Task 3.11, ADR-095)", kamed)
            }
            HStack(alignment: .top, spacing: 18) {
            }
            HStack(alignment: .top, spacing: 18) {
                window("New agent: its own role, kit and soul.md (ADR-088)", creating)
                window("One window: Chat (ADR-089)", chatting)
            }
            HStack(alignment: .top, spacing: 18) {
                window("One window: Settings (ADR-089)", setting)
                window("Overview (ADR-090)", overviewing)
            }
            HStack(alignment: .top, spacing: 18) {
                window("Needs you (ADR-090)", inboxing)
                window("Plugins: MCP servers and skills (ADR-090)", plugging)
            }
            HStack(alignment: .top, spacing: 18) {
                window("Dashboard: tokens (ADR-091)", dashing)
                window("Scheduled: routines, wake-ups, team tasks waiting (ADR-094)", scheduling)
            }
            HStack(alignment: .top, spacing: 18) {
                window("Fifty agents: chips for who matters now, then All agents (ADR-094)", crowded)
                window("All agents: everyone, searchable by name or role (ADR-094)", crowd(listOpen: true))
            }
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: name, to: directory)
        // ADR-091: the Dashboard on its own, tall enough for tokens and git.
        save(DashboardPane(model: dashing).environment(\.islandSnapshot, true).environment(\.theme, theme.palette).themed(theme.palette)
            .frame(width: 700, height: 1650).background(theme.palette.surfaceSolid.color), name: name + "-dashboard", to: directory)
        // ADR-090: the office floor on its own, at the Board's width.
        save(OfficeFloor(model: boarded).environment(\.islandSnapshot, true).environment(\.theme, theme.palette).frame(width: 660)
            .padding(16).background(Color.black), name: name + "-floor", to: directory)
        // Regression shots for what broke in use: a typed question answered with a table, and a Settings page with
        // the Back arrow in the window's top bar (and no second one in the page).
        let tabled = model(theme)
        tabled.windowPage = .chat
        let tableReply = "Here is the comparison.\\n\\n| City | Days | Best for |\\n|---|---|---|\\n| Tokyo | 3 | Food and **shopping** |\\n| Kyoto | 2 | Temples |\\n| Osaka | 1 | Street food |\\n\\nSteps:\\n1. Book the train\\n2. Pick a hotel\\n\\nUse `Suica` for transit.\\n\\n| City | **Vibe** | **Best for** | Top sights | Food highlights | Getting around | Cost |\\n|---|---|---|---|---|---|---|\\n| Tokyo | Huge, modern, fast-paced, neon and neighborhoods | Shopping, nightlife, pop culture, variety | Shibuya Crossing, Senso-ji, Shinjuku, Meiji Shrine, teamLab | Sushi, ramen, izakayas, Tsukiji outer market | Excellent but complex train network | Highest |\\n| Kyoto | Traditional, calm, temples and old streets | History, temples, gardens, geisha districts | Fushimi Inari, Kinkaku-ji, Arashiyama bamboo grove, Gion | Kaiseki, tofu, matcha sweets, Nishiki Market | Mostly buses and walking | Mid to high |"
        for line in [#"{"type":"transcript","text":"Compare Tokyo, Kyoto and Osaka in a table"}"#, #"{"type":"reply","text":"\#(tableReply)"}"#,
                     #"{"type":"turn.complete","speechMs":0,"transcriptionMs":0,"modelMs":1800,"firstSoundMs":0}"#, #"{"type":"state","state":"idle"}"#] {
            if let event = try? decodeEvent(line) { tabled.apply(event) } else { FileHandle.standardError.write(Data("gallery: could not decode a chat line\n".utf8)) }
        }
        save(window("Chat: a reply with a table, a list and code", tabled), name: name + "-chat-table", to: directory)
        let paged = model(theme)
        paged.windowPage = .settings
        paged.settingsPage = .model
        save(window("Settings page: Back is the top bar's arrow", paged), name: name + "-settings-page", to: directory)
        save(window("Board: the Needs you tab (it was a sidebar page)", inboxing), name: name + "-board-needs-you", to: directory)
        inboxing.apply(.approvalRequest(ApprovalRequest(id: "file-permission", summary: "Kame wants to change the file ~/Documents/Cedar/announcement.txt", reason: "A copy of the file is kept so you can undo it.", rememberFile: true)))
        save(window("Board: permission for one file in this chat", inboxing), name: name + "-board-file-permission", to: directory)
        let recovered = model(theme)
        recovered.windowPage = .agents
        recovered.boardView = .needsYou
        if let event = try? decodeEvent(#"{"type":"helpers","apps":[],"helpers":[{"id":"kame","name":"Kame","available":true,"jobs":[{"id":91,"task":"Finish the fictional Cedar announcement","state":"failed","createdAt":"2026-10-18T01:00:00Z","recoveryNeeded":true,"step":"Saved the draft; report not confirmed","error":"ATOM closed before this attempt's outcome was confirmed. Files may already have changed. Review the last step, tool history and file changes before trying again."}]}]}"#) { recovered.apply(event) }
        recovered.helpers.selectBoard()
        save(window("Board: interrupted attempt waits for review", recovered), name: name + "-board-interrupted", to: directory)
        // ADR-094: the floor with fifty agents: twelve seated, ten in the lounge, "+2 at work" and "+26 more".
        save(OfficeFloor(model: crowded).environment(\.islandSnapshot, true).environment(\.theme, theme.palette).frame(width: 660)
            .padding(16).background(Color.black), name: name + "-floor-crowd", to: directory)
    }

    /// ADR-075: the permissions checklist in mixed states, a plain error card, and the stopped card with its two buttons.
    private static func writeSetup(to directory: URL) {
        let suite = "atom.gallery.setup.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func model(_ theme: AppTheme = .lantern) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            m.permissions.states = [
                .microphone: .granted, .inputMonitoring: .notAsked, .accessibility: .denied,
                .automation(.music): .granted, .automation(.spotify): .notApplicable, .automation(.notes): .unchecked,
                .automation(.chrome): .notAsked, .automation(.arc): .notApplicable, .automation(.edge): .notApplicable,
                .automation(.brave): .denied, .calendar: .granted, .reminders: .notAsked,
            ]
            return m
        }
        func card(_ title: String, _ m: IslandModel, _ content: some View) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                content.padding(12).frame(width: cardWidth)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(m.settings.theme.palette.surfaceSolid.color))
                    .themed(m.settings.theme.palette)
            }
        }
        let checklist = model()
        let plain = model()
        if let event = try? decodeEvent(#"{"type":"error","stage":"model","kind":"auth","message":"Claude Code is not signed in. Run `claude auth login` in a terminal, then try again."}"#) {
            plain.status.apply(event)
        }
        let stopped = model()
        stopped.status.apply(.failed("ATOM's runtime keeps stopping: it exited with code 1"))
        let config = model(.luminous)
        config.status.apply(.configError("Invalid configuration:\n  - GEMINI_API_KEY is required (set it in .env)"))
        let sheet = HStack(alignment: .top, spacing: 22) {
            card("Settings → General → Permissions", checklist, PermissionsCard(model: checklist))
            VStack(alignment: .leading, spacing: 18) {
                card("Plain error card", plain, FailureCard(model: plain, failure: plain.status.failure!))
                card("Stopped after repeated crashes", stopped, FailureCard(model: stopped, failure: stopped.status.failure!))
                card("Config error (Luminous)", config, FailureCard(model: config, failure: config.status.failure!))
            }
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: "11-setup-cards", to: directory)
    }

    /// ADR-057: the strip and the bubble in every theme, and Pal in every mood.
    private static func writeThemes(to directory: URL) {
        for theme in AppTheme.allCases {
            let name = "9-\(theme.title.lowercased().replacingOccurrences(of: " ", with: "-"))"
            // The strip, the bubble and the point label in this theme.
            writeApproval(to: directory, theme: theme, name: name + "-strip")
            writeBubbles(to: directory, theme: theme, name: name + "-bubble")
        }

        let moods: [(PetBrain.Mood, String)] = [
            (.resting, "Resting"), (.floating, "Floating"), (.listening, "Listening"), (.thinking, "Thinking"),
            (.speaking, "Speaking"), (.worried, "Problem"), (.napping, "Napping"), (.carried, "Carried"),
        ]
        // ADR-093: the smooth 2D Pal, every mood, a later moment facing left, and how it notices you.
        do {
            let sheet = VStack(alignment: .leading, spacing: 14) {
                Text("ATOM — smooth 2D vector art").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        VStack(spacing: 2) {
                            PalView(mood: entry.0, time: 0.55, facing: 1, size: 88)
                            Text(entry.1).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        PalView(mood: entry.0, time: 1.35, facing: -1, size: 88)
                    }
                }
                Text("Second row: a later moment, facing left").font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
                // ADR-073: looking at the pointer, hovered, and each reaction at its peak.
                let notices: [(String, PetBrain.Mood, CGSize, Double, PalReaction?, Double)] = [
                    ("Looks up-left", .resting, CGSize(width: -2.2, height: -1.2), 0, nil, 0),
                    ("Looks right", .resting, CGSize(width: 2.5, height: 0), 0, nil, 0),
                    ("Hovered", .resting, .zero, 1, nil, 0),
                    ("Squish", .resting, .zero, 1, .squish, 0.25),
                    ("Dizzy", .resting, .zero, 0, .dizzy, 0.3),
                    ("Hello", .resting, .zero, 0, .hello, 0.5),
                    ("Yawn", .napping, .zero, 0, .yawn, 0.5),
                ]
                HStack(spacing: 6) {
                    ForEach(Array(notices.enumerated()), id: \.offset) { _, n in
                        VStack(spacing: 2) {
                            PalView(mood: n.1, time: 0.55, facing: 1, size: 88, gaze: n.2, hover: n.3, reaction: n.4, reactionProgress: n.5)
                            Text(n.0).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
            }
            .padding(22)
            .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
            save(sheet, name: "10-pal", to: directory)
        }
    }

    /// Computer control (ADR-054, ADR-056): the strip above the Dock while ATOM works on the Mac, the request for
    /// approval in it, how it ends, and the label beside Pal while it points.
    private static func writeApproval(to directory: URL, theme: AppTheme = .void, name: String = "8-computer-control") {
        let suite = "atom.gallery.approval.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func strip(_ title: String, _ lines: [String], stop: Bool = false) -> some View {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            for line in lines {
                guard let event = try? decodeEvent(line) else { continue }
                model.status.apply(event)
                model.apply(event)
                model.work.apply(event, now: 1)
            }
            if stop { model.work.stopped(now: 2) }
            let size = model.approval.pending?.accessChange == true ? WorkStripLayout.accessSize : model.approval.pending != nil ? WorkStripLayout.askingSize : WorkStripLayout.size
            return VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                WorkStripView(model: model, snapshot: true)
                    .frame(width: size.width + 2 * WorkStripController.shadowInset, height: size.height + 2 * WorkStripController.shadowInset)
            }
        }
        let thinking = #"{"type":"state","state":"thinking"}"#
        let step = #"{"type":"computer.step","text":"Typing in TextEdit"}"#
        let ask = #"{"type":"approval.request","id":"a1","summary":"Click \"Send\" in Mail","reason":"it may send, buy, delete or change something"}"#
        let askLong = #"{"type":"approval.request","id":"a2","summary":"Click \"Delete this project and all of the files inside it permanently\" in Finder","reason":"it may send, buy, delete or change something"}"#
        let askFile = #"{"type":"approval.request","id":"a3","summary":"Kame wants to change the file ~/Documents/Cedar/announcement.txt","reason":"a copy of the file is kept so you can undo it","rememberFile":true}"#
        let idle = #"{"type":"state","state":"idle"}"#
        let pointing = VStack(alignment: .leading, spacing: 4) {
            Text("Pointing: only a label beside ATOM").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
            HStack(spacing: -6) {
                PalView(mood: .thinking, time: 0.4, facing: 1, size: 56)
                    .environment(\.theme, theme.palette)
                PointLabelView(text: "the Send button", palette: theme.palette, snapshot: true).frame(width: 150, height: 26 + 2 * PointLabelController.shadowInset)
            }
        }
        let sheet = VStack(alignment: .leading, spacing: 14) {
            strip("Working on the Mac", [thinking, step])
            strip("Asks before a risky action", [thinking, step, ask])
            strip("Long wording is held to two lines", [thinking, askLong])
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    strip("After the turn", [thinking, step, idle])
                    strip("Stopped", [thinking, step], stop: true)
                }
                pointing
            }
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: name, to: directory)
        save(strip("Permission for one file", [thinking, askFile]).padding(24).background(theme.palette.surface.color), name: "\(name)-file-permission", to: directory)
        if name == "8-computer-control" {
            let access = #"{"type":"approval.request","id":"access-1","summary":"Enable Full access for this chat?","accessChange":true,"reason":"Only this chat. Skip routine file overwrite, classified-command, worker-browser site-opening and already-granted plugin prompts. Plugins can act outside ATOM's file sandbox. Protected files, tool/worker limits, sandboxing, cancellation and macOS permissions still apply. Plans, browser submissions/uploads/interactions, computer actions, shell previews and complete file reviews still ask. External-content safeguards remain. Stays on after restart; new and forked chats use Saved permissions. You can switch back when this chat is idle."}"#
            save(strip("Full access consent — complete scope", [thinking, access]).padding(24).background(theme.palette.surface.color), name: "34-full-access-confirmation", to: directory)
        }
    }

    /// Pal's speech bubble in the states that get one (IslandStatus.needsBubble): dictating with live words and
    /// hands-free (lit), a turn's "Speak now", a notice and an approval (amber), a problem (coral), and flipped below Pal near the top.
    private static func writeBubbles(to directory: URL, theme: AppTheme = .void, name: String = "6-pal-bubble") {
        let suite = "atom.gallery.bubble.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let inset = BubbleController.shadowInset
        func scene(_ title: String, below: Bool = false, _ setup: (IslandModel) -> Void) -> some View {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            setup(model)
            let state = BubbleState(visible: true, tailX: BubbleLayout.size.width / 2, tailOnTop: below)
            let mood: PetBrain.Mood = switch model.status.kind {
            case .listening: .listening
            case .problem: .worried
            default: .resting
            }
            let pal = PalView(mood: mood, time: 0.4, facing: 1, size: 64).environment(\.theme, theme.palette)
            return VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7)).padding(.leading, inset)
                VStack(spacing: below ? -inset - 4 : -inset - 8) {
                    if below { pal }
                    BubbleView(model: model, state: state, snapshot: true)
                    if !below { pal }
                }
                .frame(width: BubbleLayout.size.width + 2 * inset)
            }
        }
        let sheet = HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 18) {
                scene("Dictating, live words") { m in
                    m.status.apply(DictationPhase.listening)
                    m.status.setPreview("…send the deck before the call")
                    for v in [0.05, 0.2, 0.6, 0.9, 0.5, 0.8, 0.3, 0.7, 0.95, 0.6, 0.4, 0.8] { m.meter.add(v) }
                }
                scene("Hands-free") { m in
                    m.status.apply(DictationPhase.listeningHandsFree)
                    for v in [0.3, 0.7, 0.4, 0.9, 0.6, 0.2, 0.5, 0.8] { m.meter.add(v) }
                }
                // ADR-093: a turn's microphone is capturing (mic.ready).
                scene("Talking: speak now") { m in
                    m.status.apply(IslandEvent.state(.listening))
                    m.status.apply(IslandEvent.micReady)
                    for v in [0.05, 0.1, 0.4, 0.7, 0.3] { m.meter.add(v) }
                }
                scene("Needs your OK") { m in
                    if let ask = try? decodeEvent(#"{"type":"approval.request","id":"a1","summary":"Click \"Send\" in Mail","reason":"It sends"}"#) { m.status.apply(ask) }
                }
            }
            VStack(alignment: .leading, spacing: 18) {
                scene("A notice") { m in m.status.apply(DictationPhase.done(.noSpeech)) }
                scene("A problem") { m in m.status.apply(DictationPhase.done(.failed(title: "Microphone problem", message: "The microphone stopped. Check it in System Settings"))) }
                scene("Near the top: flips below ATOM", below: true) { m in m.status.apply(DictationPhase.done(.copied(reason: "A password field is focused. Paste it yourself"))) }
            }
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: name, to: directory)
    }

    /// Pal in every mood, each at three moments, on a desktop-like strip above a Dock-coloured bar.
    /// ADR-089: Pal's character in its animations, large, on the dark desktop and on a light one; then the team.
    private static func writePals(to directory: URL) {
        guard let pal = PalLibrary.pal else {
            FileHandle.standardError.write(Data("gallery: no assets/pals/pal.json\n".utf8))
            return
        }
        let animations = ["idle", "listening", "thinking", "happy", "working", "sleeping", "surprised", "angry"]
        let team = ["pal", "sid", "kame", "puff", "quill", "penny", "hana", "tinker", "rumi"]
        func row(dark: Bool) -> some View {
            HStack(spacing: 6) {
                ForEach(animations, id: \.self) { name in
                    VStack(spacing: 2) {
                        PalPortrait(character: pal, animation: name, time: 1.4, size: 150)
                        Text(name).font(.system(size: 12, weight: .medium)).foregroundStyle(dark ? .white.opacity(0.8) : .black.opacity(0.7))
                    }
                }
            }
            .padding(16)
            .background(dark ? Color(red: 0.07, green: 0.08, blue: 0.11) : Color(red: 0.93, green: 0.93, blue: 0.95))
        }
        let sheet = VStack(alignment: .leading, spacing: 0) {
            row(dark: true)
            row(dark: false)
            HStack(spacing: 6) {
                ForEach(team, id: \.self) { id in
                    VStack(spacing: 2) {
                        if let character = id == "pal" ? pal : PalLibrary.character(for: id) {
                            PalPortrait(character: character, animation: id == "kame" ? "working" : "idle", time: 6.0, size: 130)
                        }
                        Text(id.capitalized).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                    }
                }
            }
            .padding(16)
            .background(Color(red: 0.12, green: 0.14, blue: 0.2))
        }
        save(sheet, name: "16-pals", to: directory)
    }

    private static func writePet(to directory: URL, theme: AppTheme = .void, name: String = "5-pal-moods") {
        let moods: [(PetBrain.Mood, String)] = [
            (.resting, "Resting"), (.floating, "Floating"), (.listening, "Listening"), (.thinking, "Thinking"),
            (.speaking, "Speaking"), (.worried, "Problem"), (.napping, "Napping"), (.carried, "Carried"),
        ]
        let moments = [0.15, 0.55, 1.35]
        let sheet = VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                HStack(spacing: 18) {
                    Text(entry.1)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 80, alignment: .leading)
                    ForEach(Array(moments.enumerated()), id: \.offset) { i, t in
                        PalView(mood: entry.0, time: t, facing: i == 2 ? -1 : 1, size: 96)
                    }
                }
            }
        }
        .padding(20)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
        .environment(\.theme, theme.palette)
        save(sheet, name: name, to: directory)
    }

    /// ADR-084: the menu-bar item, Pal's glyph in each of its four looks on a light and a dark menu bar, at 1x
    /// and 4x. The plain glyph is a template, tinted here the way macOS tints it.
    private static func writeMenuBar(to directory: URL, flat: Bool = true, name: String = "15-menu-bar-item") {
        let lights: [(MenuBarLight, String)] = [(.plain, "Ready, thinking, speaking"), (.lit, "Listening"), (.attention, "Needs you"), (.problem, "Problem")]
        func glyph(_ light: MenuBarLight, dark: Bool, scale: CGFloat) -> some View {
            let image = Image(nsImage: MenuBarGlyph.image(light, dark: dark, scale: scale, flat: flat))
            let size = MenuBarGlyph.canvas
            return Group {
                if light.isTemplate {
                    image.renderingMode(.template).resizable().foregroundStyle(dark ? Color.white.opacity(0.92) : Color.black.opacity(0.85))
                } else {
                    image.resizable()
                }
            }
            .frame(width: size.width * scale, height: size.height * scale)
        }
        func bar(dark: Bool) -> some View {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 22) {
                    ForEach(Array(lights.enumerated()), id: \.offset) { _, entry in
                        HStack(spacing: 10) {
                            glyph(entry.0, dark: dark, scale: 1)
                            Image(systemName: "wifi").font(.system(size: 13, weight: .medium)).foregroundStyle(dark ? .white.opacity(0.92) : .black.opacity(0.85))
                        }
                        .padding(.horizontal, 8)
                        .frame(height: 24)
                        .background(dark ? Color(red: 0.11, green: 0.12, blue: 0.16) : Color(red: 0.93, green: 0.94, blue: 0.96))
                    }
                }
                HStack(spacing: 22) {
                    ForEach(Array(lights.enumerated()), id: \.offset) { _, entry in
                        VStack(spacing: 4) {
                            glyph(entry.0, dark: dark, scale: 4)
                                .padding(8)
                                .background(RoundedRectangle(cornerRadius: 10).fill(dark ? Color(red: 0.11, green: 0.12, blue: 0.16) : Color(red: 0.93, green: 0.94, blue: 0.96)))
                            Text(entry.1).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                        }
                        .frame(width: 120)
                    }
                }
            }
        }
        let sheet = VStack(alignment: .leading, spacing: 16) {
            Text(flat ? "Menu-bar item (Void: flat, no glow) — light bar, then dark bar" : "Menu-bar item — light bar, then dark bar").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            bar(dark: false)
            bar(dark: true)
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: name, to: directory)
    }

    /// Draws a view now, so a sheet can show one model in several states (views hold the live model).
    static func frozen(_ view: some View) -> AnyView {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage else { return AnyView(Color.red) }
        return AnyView(Image(nsImage: image).resizable().frame(width: image.size.width, height: image.size.height))
    }

    static func save(_ view: some View, name: String, to directory: URL) {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("gallery: could not render \(name)\n".utf8))
            return
        }
        try? png.write(to: directory.appendingPathComponent("\(name).png"))
    }

    private static func write(_ model: IslandModel, size: CGSize, name: String, to directory: URL) {
        let view = IslandView(model: model, snapshot: true)
            .frame(width: size.width, height: size.height)
            .padding(16)
            .background(Color(red: 0.36, green: 0.42, blue: 0.52)) // a desktop-like backdrop
        save(view, name: name, to: directory)
    }
}
