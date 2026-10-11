import AppKit
import SwiftUI
import ZenoIslandCore

/// Development only (`ZENO_ISLAND_GALLERY=<dir>`): renders the island's views with sample data to PNG files,
/// then exits. Starts no runtime, no microphone and no network; settings go to a throwaway defaults suite.
@MainActor
enum IslandGallery {
    static func render(to directory: URL) {
        let suite = "zeno.gallery.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        // The design study alone (ZENO_ISLAND_GALLERY_ONLY=design), for quick iteration on sheet 14.
        if ProcessInfo.processInfo.environment["ZENO_ISLAND_GALLERY_ONLY"] == "design" {
            DesignStudy.render(to: directory)
            return
        }

        let model = IslandModel(settings: IslandSettings(defaults: defaults))
        let lines = [
            #"{"type":"ready","protocol":1,"provider":"gemini","model":"gemini-3.6-flash","microphone":"Mac mini Microphone","voice":true}"#,
            #"{"type":"info","provider":"gemini","model":"gemini-3.6-flash","providers":[{"id":"claude","name":"Claude","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"},{"id":"claude-sonnet-5","name":"Claude Sonnet 5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]},{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]},{"id":"gemini","name":"Gemini","available":true,"models":[{"id":"gemini-3.8-flash","name":"Gemini 3.8 Flash"},{"id":"gemini-3.7-flash","name":"Gemini 3.7 Flash"},{"id":"gemini-3.6-flash","name":"Gemini 3.6 Flash"},{"id":"gemini-3.5-flash","name":"Gemini 3.5 Flash"},{"id":"gemini-3.5-flash-lite","name":"Gemini 3.5 Flash-Lite"},{"id":"gemini-2.5-pro","name":"Gemini 2.5 Pro"}]}]}"#,
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
        let filled = model.conversation

        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let compact = IslandMetrics().compact
        let expanded = IslandMetrics().expanded

        write(model, size: compact, name: "1-compact", to: directory)
        model.expanded = true
        for tab in IslandModel.Tab.allCases {
            model.tab = tab
            write(model, size: expanded, name: "2-\(tab.rawValue.lowercased())", to: directory)
        }
        // ADR-084: the header's Pal and light while speaking (brightest) and listening (with the live level).
        model.tab = .conversation
        for (state, level) in [("speaking", 0.0), ("listening", 0.3)] {
            if let event = try? decodeEvent(#"{"type":"state","state":"\#(state)"}"#) { model.status.apply(event) }
            for i in 0..<14 { model.meter.add(level * (0.05 + 0.95 * abs(sin(Double(i) * 0.9)))) }
            write(model, size: expanded, name: "2-conversation-\(state)", to: directory)
        }
        // ADR-084: a reply still being spoken, with the caret of light after it; the older turns recede.
        let spoken = model.conversation
        model.conversation = Conversation()
        for line in [#"{"type":"transcript","text":"What's on my calendar this afternoon?"}"#,
                     #"{"type":"reply","text":"You have a design review at 3 and a call with Aiko at 4:30. Nothing after that."}"#,
                     #"{"type":"turn.complete","speechMs":2400,"transcriptionMs":610,"modelMs":1840,"firstSoundMs":2710}"#,
                     #"{"type":"state","state":"idle"}"#,
                     #"{"type":"transcript","text":"Remind me at 4:15 to send the deck."}"#,
                     #"{"type":"reply","text":"Done. I'll remind you at 4:15 to send the deck before your call."}"#,
                     #"{"type":"state","state":"speaking"}"#] {
            if let event = try? decodeEvent(line) { model.conversation.apply(event); model.status.apply(event) }
        }
        write(model, size: expanded, name: "2-conversation-streaming", to: directory)
        model.conversation = spoken
        if let idle = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.status.apply(idle) }
        model.meter.reset()
        // The Settings tab is taller than the window and scrolls: render it tall once, so the lower cards can be reviewed.
        model.tab = .settings
        write(model, size: CGSize(width: expanded.width, height: 2000), name: "2-settings-full", to: directory)
        // ADR-084: the now card with "Last turn" opened to every stage, and with the plan meters and a problem.
        let palette = model.settings.theme.palette
        let nowCard = NowCard(model: model, timingsOpen: true)
            .padding(Spacing.panel)
            .frame(width: expanded.width)
            .background(palette.surfaceFill(solid: true))
            .themed(palette)
        save(nowCard, name: "2-settings-now-last-turn", to: directory)
        // ADR-079: the Pal page (Pal, Speech bubble, Panel) down to its "Reset this page" row.
        model.settingsPage = .pal
        write(model, size: CGSize(width: expanded.width, height: 1300), name: "2-settings-pal-full", to: directory)
        // ADR-078: a chosen home display that is unplugged.
        model.settings.palHomeDisplay = .display(uuid: "UNPLUGGED")
        write(model, size: CGSize(width: expanded.width, height: 700), name: "2-settings-pal-home-unplugged", to: directory)
        model.settings.palHomeDisplay = .main
        model.settingsPage = nil
        model.recorder.start(.talk)
        write(model, size: expanded, name: "3-recording-shortcut", to: directory)
        model.recorder.stop()
        model.tab = .conversation
        model.conversation = Conversation()
        write(model, size: expanded, name: "4-empty-conversation", to: directory)
        model.conversation = filled
        // ADR-086: Void is the default; each sheet that changed with it is also drawn in Lantern ("-lantern").
        writePals(to: directory)
        writePet(to: directory)
        writePet(to: directory, theme: .lantern, name: "5-pal-moods-lantern")
        writeBubbles(to: directory)
        writeApproval(to: directory)
        writePeek(to: directory)
        writeThemes(model: model, to: directory)
        writeSetup(to: directory, conversation: filled)
        writeEveryday(to: directory)
        writeHelpers(to: directory)
        writeHelpers(to: directory, theme: .lantern, name: "13-helpers-lantern")
        writeMenuBar(to: directory)
        writeMenuBar(to: directory, flat: false, name: "15-menu-bar-item-lantern")
        writeAvatars(to: directory)
        DesignStudy.render(to: directory)
    }

    /// ADR-081: the ZENO window with Sid running one job and done with another, the rest of the team (Task 3.3); Sid's
    /// report open; and the job list in the light Warm theme. ADR-083: Sid's model picker (Laya, then pinned), the
    /// large-model switch (on, then off) and each job's model.
    private static func writeHelpers(to directory: URL, theme: AppTheme = .void, name: String = "13-helpers") {
        let suite = "zeno.gallery.helpers.\(ProcessInfo.processInfo.processIdentifier)"
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
        let team = [("kame", "Kame", true, "coder"), ("puff", "Puff", true, "designer"), ("quill", "Quill", true, "documenter"),
                    ("penny", "Penny", true, "financial adviser"), ("hana", "Hana", true, "hr"), ("tinker", "Tinker", false, "improver"), ("rumi", "Rumi", true, "travel planner")]
            .map { id, name, available, role in
                #"{"id":"\#(id)","name":"\#(name)","available":\#(available),"app":null,"role":"\#(role)","soul":{"name":"\#(name)","personality":"…","howItWorks":"","rules":"","lessons":""},"soulVersion":1,"soulVersions":[{"version":1,"createdAt":"\#(ago(3000))"}],"custom":\#(id == "rumi"),"kit":"\#(id == "rumi" ? "think" : id == "kame" || id == "puff" ? "folders" : "research")","grants":\#(id == "kame" ? #"["\#(NSHomeDirectory())/Developer/zeno"]"# : "[]"),"jobs":[\#(id == "hana" ? hanaJob : "")]}"#
            }.joined(separator: ",")
        func helpers(pinned: String, allowLarge: Bool, failed: Bool = false) -> String { #"{"type":"helpers","apps":["Brave Browser","Notes","Safari"],"allowLarge":\#(allowLarge),"models":\#(models),"team":{"cap":15,"spent":6.4},"planLimit":80,"usage":{"today":{"input":18000,"output":7000,"cacheRead":140000,"cacheWrite":5000,"dollars":0.71,"runs":9},"week":{"input":80000,"output":31500,"cacheRead":610000,"cacheWrite":21000,"dollars":3.15,"runs":39},"days":[{"day":"2026-10-05","input":9000,"output":3000,"cacheRead":60000,"cacheWrite":2000,"dollars":0.31,"runs":4},{"day":"2026-10-06","input":0,"output":0,"cacheRead":0,"cacheWrite":0,"dollars":0,"runs":0},{"day":"2026-10-07","input":15000,"output":6000,"cacheRead":110000,"cacheWrite":4000,"dollars":0.62,"runs":7},{"day":"2026-10-08","input":4000,"output":1500,"cacheRead":30000,"cacheWrite":1000,"dollars":0.12,"runs":2},{"day":"2026-10-09","input":22000,"output":9000,"cacheRead":180000,"cacheWrite":6000,"dollars":0.95,"runs":11},{"day":"2026-10-10","input":12000,"output":5000,"cacheRead":90000,"cacheWrite":3000,"dollars":0.44,"runs":6},{"day":"2026-10-11","input":18000,"output":7000,"cacheRead":140000,"cacheWrite":5000,"dollars":0.71,"runs":9}],"byWorker":[{"helper":"sid","name":"Sid","input":40000,"output":15000,"cacheRead":320000,"cacheWrite":9000,"dollars":1.6,"runs":14},{"helper":null,"name":"ZENO chat","input":20000,"output":9000,"cacheRead":160000,"cacheWrite":6000,"dollars":0.8,"runs":19},{"helper":"quill","name":"Quill","input":20000,"output":7500,"cacheRead":130000,"cacheWrite":6000,"dollars":0.75,"runs":6}],"byModel":[{"model":"claude-sonnet-5-5","input":60000,"output":24000,"cacheRead":480000,"cacheWrite":16000,"dollars":2.7,"runs":22},{"model":"claude-haiku-5-5","input":20000,"output":7500,"cacheRead":130000,"cacheWrite":5000,"dollars":0.45,"runs":17}]},"skills":[{"name":"council","description":"Four voices for hard calls."},{"name":"pdf","description":"Read and write PDFs."}],"mcp":[{"id":1,"name":"notes","kind":"command","command":"/usr/local/bin/notes-mcp","args":["--stdio"],"transport":"http","envKeys":["NOTES_TOKEN"],"headerKeys":[],"enabled":true,"trusted":false,"workers":["sid","quill"],"tools":["search","add_note","list"],"testedAt":"2026-10-11T00:00:00Z"},{"id":2,"name":"linear","kind":"url","url":"https://mcp.linear.app/mcp","args":[],"transport":"http","envKeys":[],"headerKeys":["Authorization"],"enabled":false,"trusted":false,"workers":[],"tools":[]}],"helpers":[{"id":"sid","name":"Sid","available":true,"app":"Brave Browser","role":"researcher","budget":{"cap":5,"spent":4.1},"routines":[{"id":1,"task":"Summarise networking news","when":"Every day at 8:00 AM","lastAt":"\#(ago(120))"}],"soul":\#(sidSoul),"soulVersion":2,"soulVersions":[{"version":2,"createdAt":"\#(ago(30))"},{"version":1,"createdAt":"\#(ago(3000))"}],"pinnedModel":\#(pinned),"jobs":[\#(failed ? #"{"id":4,"task":"Compare the reviews of the new Mac mini","state":"failed","createdAt":"\#(ago(2))","endedAt":"\#(ago(1))","error":"The review pages would not load"},"# : ""){"id":3,"task":"What year was TCP/IP adopted by ARPANET?","state":"queued","createdAt":"\#(ago(1))","held":"The Claude plan is 84% used; new runs wait below 80%."},{"id":2,"task":"Research how IPv6 is rolled out in home routers","state":"running","createdAt":"\#(ago(4))","step":"Reading 3 of 8 pages","model":"claude-sonnet-4-5","modelReason":"Laya: moderate"},{"id":1,"task":"Research networking basics for a beginner","state":"done","createdAt":"\#(ago(52))","endedAt":"\#(ago(41))","title":"Networking basics","summary":"How data finds its way from your Mac to a website and back.","model":"claude-haiku-4-5","modelReason":"Laya: easy"}]},\#(team)]}"# }
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
        overviewing.windowPage = .overview
        let inboxing = model(theme, failed: true)
        inboxing.windowPage = .inbox
        let plugging = model(theme)
        plugging.windowPage = .plugins
        let dashing = model(theme)
        dashing.windowPage = .dashboard
        dashing.planUsage = PlanUsage(fiveHour: 0.62, sevenDay: 0.31)
        dashing.helpers.apply(.git([GitBranch(repo: "/Users/k/Developer/site", repoName: "site", branch: "zeno/task-12", task: 12, title: "Add a dark mode toggle",
                                              base: "origin/main", commits: [GitCommit(sha: "3f9c2a1", subject: "ZENO task 12: Add a dark mode toggle", at: nil)],
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
                window("The board: team budget and plan limit; a held task; Hana waits for Sid (Tasks 3.4, 3.7)", boarded)
                window("Kame: a granted folder, its own branch (Task 3.11)", kamed)
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
            window("Dashboard: tokens (ADR-091)", dashing)
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
    }

    /// ADR-076: What can I ask? (before and after `capabilities`), the empty conversation with examples, the plan
    /// meters on the AI model page and in Status, and a rate-limit card offering another provider.
    private static func writeEveryday(to directory: URL) {
        let suite = "zeno.gallery.everyday.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let size = IslandMetrics().expanded
        let info = #"{"type":"info","provider":"claude-plan","model":"claude-opus-5-5","providers":[{"id":"claude","name":"Claude","available":false,"models":[{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"}]},{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]},{"id":"gemini","name":"Gemini","available":true,"models":[{"id":"gemini-3.8-flash","name":"Gemini 3.8 Flash"}]}]}"#
        let capabilities = #"{"type":"capabilities","items":[{"title":"Open apps and websites","examples":["Open Safari","Go to YouTube"]},{"title":"Music","examples":["Play some jazz","Skip this song","Pause the music"]},{"title":"Timers","examples":["Set a timer for 10 minutes","How long is left?"]},{"title":"Calendar and reminders","examples":["What's on my calendar today?","Remind me to call Aiko at 5"]},{"title":"Weather","examples":["Will it rain tomorrow?"]},{"title":"Notes","examples":["Make a note: buy oat milk"]}]}"#
        func model(_ lines: [String], theme: AppTheme = .lantern) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            m.permissions.states = [.microphone: .granted, .inputMonitoring: .granted]
            m.status.apply(.running(pid: 1))
            for line in [#"{"type":"ready","protocol":1,"provider":"claude-plan","model":"claude-opus-5-5","microphone":"Mac mini Microphone","voice":true}"#, info] + lines {
                guard let event = try? decodeEvent(line) else {
                    FileHandle.standardError.write(Data("gallery: could not decode \(line)\n".utf8))
                    continue
                }
                m.status.apply(event)
                m.apply(event)
            }
            m.expanded = true
            return m
        }
        func panel(_ title: String, _ m: IslandModel, tab: IslandModel.Tab, page: IslandModel.SettingsPage? = nil) -> some View {
            m.tab = tab
            m.settingsPage = page
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                frozen(IslandView(model: m, snapshot: true).frame(width: size.width, height: size.height))
            }
        }
        let usage = #"{"type":"plan.usage","fiveHour":0.42,"sevenDay":0.86,"overage":false}"#
        let high = #"{"type":"plan.usage","fiveHour":0.97,"sevenDay":0.12}"#
        let limited = model([#"{"type":"error","stage":"model","kind":"rate_limit","message":"Your Claude plan limit is reached. It resets at 3 pm.","retryable":true}"#])
        let sheet = VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                panel("What can I ask?", model([capabilities]), tab: .settings, page: .examples)
                panel("Before capabilities arrive: shortcuts only", model([]), tab: .settings, page: .examples)
                panel("Empty conversation with examples", model([capabilities]), tab: .conversation)
                panel("Settings list", model([capabilities]), tab: .settings)
            }
            HStack(alignment: .top, spacing: 18) {
                panel("AI model page: 42% and 86%", model([usage]), tab: .settings, page: .model)
                panel("Now card: 97% (Luminous)", model([high], theme: .luminous), tab: .settings)
                panel("Rate limit: switch provider", limited, tab: .conversation)
                panel("No usage yet: no meters", model([]), tab: .settings)
            }
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: "12-everyday", to: directory)
    }

    /// ADR-075: the permissions checklist in mixed states, a plain error card, the stopped card with its two buttons,
    /// and the panel as a new user first sees it.
    private static func writeSetup(to directory: URL, conversation: Conversation) {
        let suite = "zeno.gallery.setup.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let size = IslandMetrics().expanded
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
                content.padding(12).frame(width: size.width)
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
        stopped.status.apply(.failed("ZENO's runtime keeps stopping: it exited with code 1"))
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

        // The panel on first launch: the stopped card and the first-launch card above an empty conversation.
        let first = model()
        first.status.apply(.failed("ZENO's runtime keeps stopping: it exited with code 1"))
        first.expanded = true
        write(first, size: size, name: "11-setup-panel", to: directory)
        // A plain error above a conversation already under way.
        let busy = model()
        busy.permissions.states[.inputMonitoring] = .granted
        if let event = try? decodeEvent(#"{"type":"error","stage":"transcription","message":"Whisper model not found at \"models/ggml-small.en.bin\". Download it with: curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"}"#) {
            busy.status.apply(event)
        }
        busy.conversation = conversation
        busy.expanded = true
        write(busy, size: size, name: "11-setup-panel-conversation", to: directory)
    }

    /// ADR-057: every surface in every theme, and every Pal style in every mood.
    private static func writeThemes(model: IslandModel, to directory: URL) {
        let saved = (model.settings.theme, model.settings.palStyle, model.tab, model.settingsPage)
        defer { (model.settings.theme, model.settings.palStyle, model.tab, model.settingsPage) = saved }
        let size = IslandMetrics().expanded
        for theme in AppTheme.allCases {
            model.settings.theme = theme
            let name = "9-\(theme.title.lowercased().replacingOccurrences(of: " ", with: "-"))"
            var panels: [AnyView] = []
            model.expanded = true
            let restore = model.conversation
            for (tab, page) in [(IslandModel.Tab.conversation, nil), (.settings, nil), (.settings, IslandModel.SettingsPage.appearance),
                                (.settings, .model), (.settings, .pal), (.settings, .examples)] as [(IslandModel.Tab, IslandModel.SettingsPage?)] {
                model.tab = tab
                model.settingsPage = page
                panels.append(frozen(IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height)))
            }
            model.conversation = Conversation()
            model.tab = .conversation
            panels.append(frozen(IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height)))
            model.conversation = restore
            // Memory (ADR-058): a few kept facts, then nothing kept.
            let savedMemory = model.memory
            model.tab = .settings
            model.settingsPage = .memory
            let now = Date()
            model.memory = MemoryList(enabled: true, count: 3, memories: [
                MemoryItem(id: 3, text: "Keshab takes his coffee black, no sugar.", createdAt: now.addingTimeInterval(-300), source: "voice"),
                MemoryItem(id: 2, text: "Keshab's sister is called Asha and she lives in Osaka.", createdAt: now.addingTimeInterval(-86_400 * 2), source: "voice"),
                MemoryItem(id: 1, text: "Keshab prefers replies in short sentences.", createdAt: now.addingTimeInterval(-86_400 * 9), source: "text"),
            ], episodes: [
                EpisodeItem(id: 2, summary: "The user is planning a November weekend in Kyoto, avoiding crowds; Fushimi Inari at 7 am on Saturday. Dates still open.", endedAt: now.addingTimeInterval(-3_600 * 3), exchanges: 4),
            ])
            panels.append(frozen(IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height)))
            model.memory = MemoryList(enabled: true, count: 0, memories: [])
            panels.append(frozen(IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height)))
            model.memory = savedMemory
            let sheet = VStack(alignment: .leading, spacing: 18) {
                Text("\(theme.title) — panel").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                HStack(alignment: .top, spacing: 18) { ForEach(0..<5, id: \.self) { panels[$0] } }
                HStack(alignment: .top, spacing: 18) { ForEach(5..<9, id: \.self) { panels[$0] } }
            }
            .padding(24)
            .background(Color(red: 0.36, green: 0.42, blue: 0.52))
            save(sheet, name: name + "-panel", to: directory)

            // The strip, the bubble and the point label in this theme.
            writeApproval(to: directory, theme: theme, name: name + "-strip")
            writeBubbles(to: directory, theme: theme, name: name + "-bubble")
        }

        let moods: [(PetBrain.Mood, String)] = [
            (.resting, "Resting"), (.floating, "Floating"), (.listening, "Listening"), (.thinking, "Thinking"),
            (.speaking, "Speaking"), (.worried, "Problem"), (.napping, "Napping"), (.carried, "Carried"),
        ]
        // ADR-086: every Pal style flat under Void, on black and on a desktop.
        let flat = VStack(alignment: .leading, spacing: 10) {
            Text("Void — Pal is flat: no halo, glow or shadow; a status dot").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            ForEach(PalStyle.allCases, id: \.self) { style in
                HStack(spacing: 6) {
                    Text(style.title).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75)).frame(width: 70, alignment: .leading)
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        PalView(mood: entry.0, time: 0.55, facing: 1, size: 64, style: style)
                    }
                }
            }
            HStack(spacing: 6) { ForEach(moods.map(\.1), id: \.self) { Text($0).font(.system(size: 10)).foregroundStyle(.white.opacity(0.5)).frame(width: 96) } }
                .padding(.leading, 76)
        }
        .padding(22)
        .background(Color.black)
        .environment(\.theme, .void)
        save(flat, name: "9-void-pal", to: directory)
        for style in PalStyle.allCases {
            let sheet = VStack(alignment: .leading, spacing: 14) {
                Text("Pal — \(style.title)").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        VStack(spacing: 2) {
                            PalView(mood: entry.0, time: 0.55, facing: 1, size: 88, style: style)
                            Text(entry.1).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        PalView(mood: entry.0, time: 1.35, facing: -1, size: 88, style: style)
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
                            PalView(mood: n.1, time: 0.55, facing: 1, size: 88, style: style, gaze: n.2, hover: n.3, reaction: n.4, reactionProgress: n.5)
                            Text(n.0).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
            }
            .padding(22)
            .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
            save(sheet, name: "10-pal-\(style.title.lowercased())", to: directory)
            writePeek(to: directory, style: style, name: "10-pal-\(style.title.lowercased())-peek")
        }
    }

    /// Pal hiding at a display edge (ADR-053): leaning 35-50 degrees from its feet, the body cut off by the edge.
    private static func writePeek(to directory: URL, style: PalStyle = .ghost, name: String = "7-pal-peek") {
        let side: CGFloat = 170
        let unit: CGFloat = 56
        let view: CGFloat = unit * 1.5
        func edge(_ title: String, left: Bool, lean: PalLean, revealed: Bool) -> some View {
            let peek = Peek(edge: left ? .left : .right, display: CGRect(x: 0, y: 0, width: side, height: side))
            let feet = PeekLayout.feet(for: peek, y: 24, revealed: revealed)
            let degrees = PeekLayout.rotation(for: peek, lean: lean)
            // The view's centre, so that the feet land on `feet` (ground inset measured from the bottom).
            let centre = CGPoint(x: feet.x, y: side - feet.y - view / 2 + PalView.groundInset(for: unit))
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                ZStack(alignment: .topLeading) {
                    LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom)
                    PalView(mood: .resting, time: 0.4, facing: left ? 1 : -1, size: unit, hide: PeekLayout.amount(rotation: degrees), tilt: degrees, edgeGap: -Double(PeekLayout.inset + (revealed ? PeekLayout.revealExtra : 0)) * 64 / Double(unit), style: style)
                        .rotationEffect(.degrees(degrees), anchor: UnitPoint(x: 0.5, y: PalView.feetFraction))
                        .position(x: centre.x, y: centre.y)
                    Rectangle().fill(.white.opacity(0.35)).frame(width: 1.5, height: side).offset(x: left ? 0 : side - 1.5)
                }
                .frame(width: side, height: side)
                .clipped()
                .overlay(Text("display edge").font(.system(size: 9)).foregroundStyle(.white.opacity(0.5)).padding(5), alignment: left ? .bottomLeading : .bottomTrailing)
                .accessibilityHidden(true)
            }
        }
        let sheet = VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                edge("Left, slight (35°)", left: true, lean: .slight, revealed: false)
                edge("Left, normal (42°)", left: true, lean: .normal, revealed: false)
                edge("Left, deep (50°)", left: true, lean: .deep, revealed: false)
            }
            HStack(alignment: .top, spacing: 14) {
                edge("Left, pointer over it", left: true, lean: .normal, revealed: true)
                edge("Right, normal (42°)", left: false, lean: .normal, revealed: false)
                edge("Right, pointer over it", left: false, lean: .normal, revealed: true)
            }
        }
        .padding(20)
        .background(Color(white: 0.08))
        save(sheet, name: name, to: directory)
    }

    /// Computer control (ADR-054, ADR-056): the strip above the Dock while ZENO works on the Mac, the request for
    /// approval in it, how it ends, and the label beside Pal while it points.
    private static func writeApproval(to directory: URL, theme: AppTheme = .void, name: String = "8-computer-control") {
        let suite = "zeno.gallery.approval.\(ProcessInfo.processInfo.processIdentifier)"
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
            let size = model.approval.pending != nil ? WorkStripLayout.askingSize : WorkStripLayout.size
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
        let idle = #"{"type":"state","state":"idle"}"#
        let pointing = VStack(alignment: .leading, spacing: 4) {
            Text("Pointing: only a label beside Pal").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
            HStack(spacing: -6) {
                PalView(mood: .thinking, time: 0.4, facing: 1, size: 56, style: theme == .native ? .orb : (theme == .warm ? .companion : .orb))
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
    }

    /// Pal's speech bubble in the states that get one (IslandStatus.needsBubble): dictating with live words and
    /// hands-free (lit), a notice and an approval (amber), a problem (coral), and flipped below Pal near the top.
    private static func writeBubbles(to directory: URL, theme: AppTheme = .void, name: String = "6-pal-bubble") {
        let suite = "zeno.gallery.bubble.\(ProcessInfo.processInfo.processIdentifier)"
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
            let pal = PalView(mood: mood, time: 0.4, facing: 1, size: 64, glow: mood == .listening ? 1.6 : 1).environment(\.theme, theme.palette)
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
                scene("Needs your OK") { m in
                    if let ask = try? decodeEvent(#"{"type":"approval.request","id":"a1","summary":"Click \"Send\" in Mail","reason":"It sends"}"#) { m.status.apply(ask) }
                }
            }
            VStack(alignment: .leading, spacing: 18) {
                scene("A notice") { m in m.status.apply(DictationPhase.done(.noSpeech)) }
                scene("A problem") { m in m.status.apply(DictationPhase.done(.failed(title: "Microphone problem", message: "The microphone stopped. Check it in System Settings"))) }
                scene("Near the top: flips below Pal", below: true) { m in m.status.apply(DictationPhase.done(.copied(reason: "A password field is focused. Paste it yourself"))) }
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

    /// ADR-085: Pal's avatar for each expression and every helper's four, from whatever images exist
    /// (`ZENO_AVATARS_DIR`, else the repo's assets/avatars). A missing image shows today's drawing.
    private static func writeAvatars(to directory: URL) {
        let pal: [(String, PetBrain.Mood, PalReaction?, Double)] = [
            ("neutral", .resting, nil, 0.3), ("happy (hello)", .resting, .hello, 0.3), ("listening", .listening, nil, 0.3),
            ("thinking", .thinking, nil, 0.3), ("speaking", .speaking, nil, 0.01), ("speaking-closed", .speaking, nil, 0.1),
            ("worried", .worried, nil, 0.3), ("sleepy", .napping, nil, 0.3), ("surprised", .carried, nil, 0.3),
        ]
        let helpers = ["sid", "kame", "puff", "quill", "penny", "hana", "tinker"]
        let jobs: [(String, [JobState])] = [("neutral", []), ("working", [.running]), ("happy", [.done]), ("worried", [.failed])]
        let caption = AvatarImages.hasPal
            ? "From \(AvatarImages.directory?.path ?? "?")"
            : "no avatar images yet: Pal is drawn as the orb, helpers as their letter"
        let palette = AppTheme.lantern.palette
        let sheet = VStack(alignment: .leading, spacing: 14) {
            Text("Avatars (ADR-085)").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            Text(caption).font(.system(size: 11)).foregroundStyle(.white.opacity(0.7))
            HStack(spacing: 6) {
                ForEach(Array(pal.enumerated()), id: \.offset) { _, w in
                    VStack(spacing: 2) {
                        PalView(mood: w.1, time: w.3, facing: 1, size: 72, style: .avatar, reaction: w.2, reactionProgress: 0.5)
                        Text(w.0).font(.system(size: 10.5, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                    }
                }
            }
            HStack(alignment: .top, spacing: 16) {
                ForEach(helpers, id: \.self) { id in
                    VStack(spacing: 6) {
                        Text(id.capitalized).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                        ForEach(Array(jobs.enumerated()), id: \.offset) { _, job in
                            HStack(spacing: 11) {
                                HelperBadge(helper: Helper(id: id, name: id.capitalized, available: true, app: nil,
                                                           jobs: job.1.map { HelperJob(id: 1, task: "", state: $0) }), size: 40)
                                Text(job.0).font(.system(size: 10)).foregroundStyle(.white.opacity(0.6)).frame(width: 46, alignment: .leading)
                            }
                        }
                    }
                }
            }
            .themed(palette)
        }
        .padding(22)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: "16-avatars", to: directory)
    }

    /// Draws a view now, so a sheet can show one model in several states (views hold the live model).
    private static func frozen(_ view: some View) -> AnyView {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage else { return AnyView(Color.red) }
        return AnyView(Image(nsImage: image).resizable().frame(width: image.size.width, height: image.size.height))
    }

    private static func save(_ view: some View, name: String, to directory: URL) {
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
