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

        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let compact = IslandMetrics().compact
        let expanded = IslandMetrics().expanded

        write(model, size: compact, name: "1-compact", to: directory)
        model.expanded = true
        for tab in IslandModel.Tab.allCases {
            model.tab = tab
            write(model, size: expanded, name: "2-\(tab.rawValue.lowercased())", to: directory)
        }
        // The Settings tab is taller than the window and scrolls: render it tall once, so the lower cards can be reviewed.
        model.tab = .settings
        write(model, size: CGSize(width: expanded.width, height: 2000), name: "2-settings-full", to: directory)
        model.recorder.start(.talk)
        write(model, size: expanded, name: "3-recording-shortcut", to: directory)
        model.recorder.stop()
        model.tab = .conversation
        model.conversation = Conversation()
        write(model, size: expanded, name: "4-empty-conversation", to: directory)
        writePet(to: directory)
        writeBubbles(to: directory)
        writeApproval(to: directory)
        writePeek(to: directory)
    }

    /// Wisp hiding at a display edge (ADR-053): leaning 35-50 degrees from its feet, the body cut off by the edge.
    private static func writePeek(to directory: URL) {
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
                    WispView(mood: .resting, time: 0.4, facing: left ? 1 : -1, size: unit, hide: PeekLayout.amount(rotation: degrees), tilt: degrees, edgeGap: -Double(PeekLayout.inset + (revealed ? PeekLayout.revealExtra : 0)) * 64 / Double(unit))
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
        save(sheet, name: "7-wisp-peek", to: directory)
    }

    /// Computer control (ADR-054): the bubble while ZENO works on the Mac, and the card that asks before a risky action.
    private static func writeApproval(to directory: URL) {
        let suite = "zeno.gallery.approval.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func working(_ title: String, _ lines: [String]) -> some View {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            for line in lines { if let event = try? decodeEvent(line) { model.status.apply(event); model.apply(event) } }
            let state = BubbleState(visible: true, tailX: BubbleLayout.size.width / 2, tailOnTop: false)
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                VStack(spacing: -14) {
                    BubbleView(model: model, state: state, snapshot: true)
                    WispView(mood: .thinking, time: 0.4, facing: 1, size: 72)
                }
                .frame(width: BubbleLayout.size.width + 24)
            }
        }
        func asking(_ title: String, summary: String, reason: String, below: Bool = false) -> some View {
            let card = ApprovalCardState(request: ApprovalRequest(id: "a1", summary: summary, reason: reason), visible: true, tailOnTop: below)
            let wisp = WispView(mood: .thinking, time: 0.4, facing: 1, size: 72)
            return VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                VStack(spacing: below ? -2 : -14) {
                    if below { wisp }
                    ApprovalView(state: card, onAnswer: { _ in }, snapshot: true)
                    if !below { wisp }
                }
                .frame(width: ApprovalController.size.width + 24)
            }
        }
        let step = #"{"type":"computer.step","text":"Typing in TextEdit"}"#
        let sheet = HStack(alignment: .top, spacing: 26) {
            VStack(spacing: 22) {
                working("Working on the Mac", [#"{"type":"state","state":"thinking"}"#, step])
                asking("Asks before sending", summary: #"Click "Send" in Mail"#, reason: "it may send, buy, delete or change something")
            }
            VStack(spacing: 22) {
                asking("Long wording is held to two lines", summary: #"Click "Delete this project and all of the files inside it permanently" in Finder"#, reason: "it may send, buy, delete or change something")
                asking("Near the top: below Wisp", summary: "Press delete in TextEdit", reason: "it uses the Delete key", below: true)
            }
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(red: 0.17, green: 0.21, blue: 0.31), Color(red: 0.26, green: 0.31, blue: 0.45)], startPoint: .top, endPoint: .bottom))
        save(sheet, name: "8-computer-control", to: directory)
    }

    /// Wisp's speech bubble in the states that matter: dictating with words, hands-free, thinking, a notice, and flipped below Wisp.
    private static func writeBubbles(to directory: URL) {
        let suite = "zeno.gallery.bubble.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func scene(_ title: String, below: Bool = false, _ setup: (IslandModel) -> Void) -> some View {
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
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
        save(sheet, name: "6-wisp-bubble", to: directory)
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
