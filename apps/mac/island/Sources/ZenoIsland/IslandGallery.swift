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
        // ADR-084: the header's Wisp and light while speaking (brightest) and listening (with the live level).
        model.tab = .conversation
        for (state, level) in [("speaking", 0.0), ("listening", 0.3)] {
            if let event = try? decodeEvent(#"{"type":"state","state":"\#(state)"}"#) { model.status.apply(event) }
            for i in 0..<14 { model.meter.add(level * (0.05 + 0.95 * abs(sin(Double(i) * 0.9)))) }
            write(model, size: expanded, name: "2-conversation-\(state)", to: directory)
        }
        if let idle = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.status.apply(idle) }
        model.meter.reset()
        // The Settings tab is taller than the window and scrolls: render it tall once, so the lower cards can be reviewed.
        model.tab = .settings
        write(model, size: CGSize(width: expanded.width, height: 2000), name: "2-settings-full", to: directory)
        // ADR-079: the Wisp page (Wisp, Speech bubble, Panel) down to its "Reset this page" row.
        model.settingsPage = .wisp
        write(model, size: CGSize(width: expanded.width, height: 1300), name: "2-settings-wisp-full", to: directory)
        // ADR-078: a chosen home display that is unplugged.
        model.settings.wispHomeDisplay = .display(uuid: "UNPLUGGED")
        write(model, size: CGSize(width: expanded.width, height: 700), name: "2-settings-wisp-home-unplugged", to: directory)
        model.settings.wispHomeDisplay = .main
        model.settingsPage = nil
        model.recorder.start(.talk)
        write(model, size: expanded, name: "3-recording-shortcut", to: directory)
        model.recorder.stop()
        model.tab = .conversation
        model.conversation = Conversation()
        write(model, size: expanded, name: "4-empty-conversation", to: directory)
        model.conversation = filled
        writePet(to: directory)
        writeBubbles(to: directory)
        writeApproval(to: directory)
        writePeek(to: directory)
        writeThemes(model: model, to: directory)
        writeSetup(to: directory, conversation: filled)
        writeEveryday(to: directory)
        writeHelpers(to: directory)
        writeMenuBar(to: directory)
        DesignStudy.render(to: directory)
    }

    /// ADR-081: the Helpers window with Sid running one job and done with another, Kame and Puff coming soon; Sid's
    /// report open; and the job list in the light Warm theme. ADR-083: Sid's model picker (Laya, then pinned), the
    /// large-model switch (on, then off) and each job's model.
    private static func writeHelpers(to directory: URL) {
        let suite = "zeno.gallery.helpers.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let iso = ISO8601DateFormatter()
        let ago = { (minutes: Double) in iso.string(from: Date().addingTimeInterval(-minutes * 60)) }
        // ADR-083: the plan's models, the large-model switch, Sid's pin (null: Laya chooses) and each job's model.
        let models = #"[{"id":"claude-haiku-4-5","name":"Claude Haiku 4.5","tier":"small"},{"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5","tier":"medium"},{"id":"claude-opus-5-5","name":"Claude Opus 5.5","tier":"large"}]"#
        func helpers(pinned: String, allowLarge: Bool) -> String { #"{"type":"helpers","apps":["Brave Browser","Notes","Safari"],"allowLarge":\#(allowLarge),"models":\#(models),"helpers":[{"id":"sid","name":"Sid","available":true,"app":"Brave Browser","pinnedModel":\#(pinned),"jobs":[{"id":3,"task":"What year was TCP/IP adopted by ARPANET?","state":"queued","createdAt":"\#(ago(1))"},{"id":2,"task":"Research how IPv6 is rolled out in home routers","state":"running","createdAt":"\#(ago(4))","step":"Reading 3 of 8 pages","model":"claude-sonnet-4-5","modelReason":"Laya: moderate"},{"id":1,"task":"Research networking basics for a beginner","state":"done","createdAt":"\#(ago(52))","endedAt":"\#(ago(41))","title":"Networking basics","summary":"How data finds its way from your Mac to a website and back.","model":"claude-haiku-4-5","modelReason":"Laya: easy"}]},{"id":"kame","name":"Kame","available":false,"app":null,"jobs":[]},{"id":"puff","name":"Puff","available":false,"app":null,"jobs":[]}]}"# }
        let report = #"{"type":"report","id":1,"title":"Networking basics","summary":"How data finds its way from your Mac to a website and back.","body":"Every device on a network has an address. Your router hands one to your Mac, and translates between your home network and the internet.\n\nData travels in small packets. Each packet carries where it is going, and routers along the way pass it on, one hop at a time.\n\nNames like apple.com are turned into addresses by DNS before any packet is sent.","sources":[{"title":"How the Internet works","url":"https://developer.mozilla.org/en-US/docs/Learn/Common_questions/Web_mechanics/How_does_the_Internet_work"},{"title":"Internet Protocol (RFC 791)","url":"https://www.rfc-editor.org/rfc/rfc791"}]}"#
        func model(_ theme: AppTheme, pinned: String = "null", allowLarge: Bool = true) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            if let event = try? decodeEvent(helpers(pinned: pinned, allowLarge: allowLarge)) { m.apply(event) } else {
                FileHandle.standardError.write(Data("gallery: could not decode helpers\n".utf8))
            }
            return m
        }
        func window(_ title: String, _ m: IslandModel) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                frozen(HelpersView(model: m).environment(\.islandSnapshot, true).frame(width: 720, height: 520))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        let reading = model(.lantern)
        _ = reading.helpers.openReport(1)
        if let event = try? decodeEvent(report) { reading.apply(event) }
        let sheet = VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                window("Helpers: Sid's model chosen by Laya, jobs show their model", model(.lantern))
                window("Sid's report", reading)
            }
            window("Warm (light): Sid pinned to Sonnet, large model off", model(.warm, pinned: #""claude-sonnet-4-5""#, allowLarge: false))
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: "13-helpers", to: directory)
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
                panel("Status: 97% (Luminous)", model([high], theme: .luminous), tab: .status)
                panel("Rate limit: switch provider", limited, tab: .conversation)
                panel("No usage yet: no meters", model([]), tab: .status)
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

    /// ADR-057: every surface in every theme, and every Wisp style in every mood.
    private static func writeThemes(model: IslandModel, to directory: URL) {
        let saved = (model.settings.theme, model.settings.wispStyle, model.tab, model.settingsPage)
        defer { (model.settings.theme, model.settings.wispStyle, model.tab, model.settingsPage) = saved }
        let size = IslandMetrics().expanded
        for theme in AppTheme.allCases {
            model.settings.theme = theme
            let name = "9-\(theme.title.lowercased().replacingOccurrences(of: " ", with: "-"))"
            var panels: [AnyView] = []
            model.expanded = true
            let restore = model.conversation
            for (tab, page) in [(IslandModel.Tab.conversation, nil), (.settings, nil), (.settings, IslandModel.SettingsPage.appearance),
                                (.settings, .model), (.settings, .wisp), (.status, nil)] as [(IslandModel.Tab, IslandModel.SettingsPage?)] {
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
        for style in WispStyle.allCases {
            let sheet = VStack(alignment: .leading, spacing: 14) {
                Text("Wisp — \(style.title)").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        VStack(spacing: 2) {
                            WispView(mood: entry.0, time: 0.55, facing: 1, size: 88, style: style)
                            Text(entry.1).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
                HStack(spacing: 6) {
                    ForEach(Array(moods.enumerated()), id: \.offset) { _, entry in
                        WispView(mood: entry.0, time: 1.35, facing: -1, size: 88, style: style)
                    }
                }
                Text("Second row: a later moment, facing left").font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
                // ADR-073: looking at the pointer, hovered, and each reaction at its peak.
                let notices: [(String, PetBrain.Mood, CGSize, Double, WispReaction?, Double)] = [
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
                            WispView(mood: n.1, time: 0.55, facing: 1, size: 88, style: style, gaze: n.2, hover: n.3, reaction: n.4, reactionProgress: n.5)
                            Text(n.0).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        }
                    }
                }
            }
            .padding(22)
            .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
            save(sheet, name: "10-wisp-\(style.title.lowercased())", to: directory)
            writePeek(to: directory, style: style, name: "10-wisp-\(style.title.lowercased())-peek")
        }
    }

    /// Wisp hiding at a display edge (ADR-053): leaning 35-50 degrees from its feet, the body cut off by the edge.
    private static func writePeek(to directory: URL, style: WispStyle = .ghost, name: String = "7-wisp-peek") {
        let side: CGFloat = 170
        let unit: CGFloat = 56
        let view: CGFloat = unit * 1.5
        func edge(_ title: String, left: Bool, lean: WispLean, revealed: Bool) -> some View {
            let peek = Peek(edge: left ? .left : .right, display: CGRect(x: 0, y: 0, width: side, height: side))
            let feet = PeekLayout.feet(for: peek, y: 24, revealed: revealed)
            let degrees = PeekLayout.rotation(for: peek, lean: lean)
            // The view's centre, so that the feet land on `feet` (ground inset measured from the bottom).
            let centre = CGPoint(x: feet.x, y: side - feet.y - view / 2 + WispView.groundInset(for: unit))
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                ZStack(alignment: .topLeading) {
                    LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom)
                    WispView(mood: .resting, time: 0.4, facing: left ? 1 : -1, size: unit, hide: PeekLayout.amount(rotation: degrees), tilt: degrees, edgeGap: -Double(PeekLayout.inset + (revealed ? PeekLayout.revealExtra : 0)) * 64 / Double(unit), style: style)
                        .rotationEffect(.degrees(degrees), anchor: UnitPoint(x: 0.5, y: WispView.feetFraction))
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
    /// approval in it, how it ends, and the label beside Wisp while it points.
    private static func writeApproval(to directory: URL, theme: AppTheme = .lantern, name: String = "8-computer-control") {
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
            Text("Pointing: only a label beside Wisp").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
            HStack(spacing: -6) {
                WispView(mood: .thinking, time: 0.4, facing: 1, size: 56, style: theme == .native ? .orb : (theme == .warm ? .companion : .orb))
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

    /// Wisp's speech bubble in the states that matter: dictating with words, hands-free, thinking, a notice, and flipped below Wisp.
    private static func writeBubbles(to directory: URL, theme: AppTheme = .lantern, name: String = "6-wisp-bubble") {
        let suite = "zeno.gallery.bubble.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func scene(_ title: String, below: Bool = false, _ setup: (IslandModel) -> Void) -> some View {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            setup(model)
            let state = BubbleState(visible: true, tailX: BubbleLayout.size.width / 2, tailOnTop: below)
            let wisp = WispView(mood: model.status.kind == .listening ? .listening : .thinking, time: 0.4, facing: 1, size: 72)
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                VStack(spacing: below ? -2 : -14) {
                    if below { wisp }
                    BubbleView(model: model, state: state, snapshot: true)
                    if !below { wisp }
                }
                .frame(width: BubbleLayout.size.width + 24)
            }
        }
        let sheet = HStack(alignment: .top, spacing: 26) {
            VStack(spacing: 22) {
                scene("Dictating, live words") { m in
                    m.status.apply(DictationPhase.listening)
                    m.status.setPreview("…send the deck before the call")
                    for v in [0.2, 0.6, 0.9, 0.5, 0.8, 0.3, 0.7] { m.meter.add(v) }
                }
                scene("Hands-free") { m in
                    m.status.apply(DictationPhase.listeningHandsFree)
                    for v in [0.3, 0.7, 0.4, 0.9, 0.6] { m.meter.add(v) }
                }
            }
            VStack(spacing: 22) {
                scene("Transcribing") { m in m.status.apply(DictationPhase.listening); m.status.apply(DictationPhase.transcribing) }
                scene("Typed") { m in m.status.apply(DictationPhase.done(.typed(words: 12))) }
                scene("Near the top: flips below Wisp", below: true) { m in m.status.apply(DictationPhase.done(.copied(reason: "A password field is focused. Paste it yourself"))) }
            }
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: name, to: directory)
    }

    /// Wisp in every mood, each at three moments, on a desktop-like strip above a Dock-coloured bar.
    private static func writePet(to directory: URL) {
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
                        WispView(mood: entry.0, time: t, facing: i == 2 ? -1 : 1, size: 96)
                    }
                }
            }
        }
        .padding(20)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.24, green: 0.29, blue: 0.42)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: "5-wisp-moods", to: directory)
    }

    /// ADR-084: the menu-bar item, Wisp's glyph in each of its four looks on a light and a dark menu bar, at 1x
    /// and 4x. The plain glyph is a template, tinted here the way macOS tints it.
    private static func writeMenuBar(to directory: URL) {
        let lights: [(MenuBarLight, String)] = [(.plain, "Ready, thinking, speaking"), (.lit, "Listening"), (.attention, "Needs you"), (.problem, "Problem")]
        func glyph(_ light: MenuBarLight, dark: Bool, scale: CGFloat) -> some View {
            let image = Image(nsImage: MenuBarGlyph.image(light, dark: dark, scale: scale))
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
            Text("Menu-bar item — light bar, then dark bar").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            bar(dark: false)
            bar(dark: true)
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: "15-menu-bar-item", to: directory)
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
