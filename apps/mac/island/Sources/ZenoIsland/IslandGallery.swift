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
            #"{"type":"info","provider":"gemini","model":"gemini-3.6-flash","providers":[{"id":"claude","name":"Claude","available":true,"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"},{"id":"claude-sonnet-5-5","name":"Claude Sonnet 5.5"},{"id":"claude-sonnet-5","name":"Claude Sonnet 5"},{"id":"claude-haiku-4-5-20251001","name":"Claude Haiku 4.5"}]},{"id":"gemini","name":"Gemini","available":true,"models":[{"id":"gemini-3.8-flash","name":"Gemini 3.8 Flash"},{"id":"gemini-3.7-flash","name":"Gemini 3.7 Flash"},{"id":"gemini-3.6-flash","name":"Gemini 3.6 Flash"},{"id":"gemini-3.5-flash","name":"Gemini 3.5 Flash"},{"id":"gemini-3.5-flash-lite","name":"Gemini 3.5 Flash-Lite"},{"id":"gemini-2.5-pro","name":"Gemini 2.5 Pro"}]}]}"#,
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
        model.tab = .settings
        model.recorder.start(.talk)
        write(model, size: expanded, name: "3-recording-shortcut", to: directory)
        model.recorder.stop()
        model.tab = .conversation
        model.conversation = Conversation()
        write(model, size: expanded, name: "4-empty-conversation", to: directory)
        writePet(to: directory)
    }

    /// Wisp in every mood, each at three moments, on a desktop-like strip above a Dock-coloured bar.
    private static func writePet(to directory: URL) {
        let moods: [(PetBrain.Mood, String)] = [
            (.resting, "Resting"), (.floating, "Floating"), (.listening, "Listening"), (.thinking, "Thinking"),
            (.speaking, "Speaking"), (.worried, "Problem"), (.napping, "Napping"),
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
