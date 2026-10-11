import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Setup and errors: permissions (ADR-075)")
struct PermissionTests {
    @Test func everyRowHasAUsageLineAndASettingsPane() {
        for row in PermissionRow.all {
            #expect(!row.title.isEmpty)
            #expect(!row.usage.isEmpty)
            #expect(row.settingsURL.scheme == "x-apple.systempreferences")
        }
    }

    @Test func rowsCoverEveryPermissionZenoUses() {
        let titles = PermissionRow.all.map(\.title)
        #expect(titles == ["Microphone", "Input Monitoring", "Accessibility",
                           "Music", "Spotify", "Notes", "Google Chrome", "Arc", "Microsoft Edge", "Brave Browser",
                           "Calendar", "Reminders"])
        #expect(PermissionRow.essential == [.microphone, .inputMonitoring])
    }

    @Test func settingsPanesAreTheRightOnes() {
        let base = "x-apple.systempreferences:com.apple.preference.security?"
        #expect(PermissionRow.microphone.settingsURL.absoluteString == base + "Privacy_Microphone")
        #expect(PermissionRow.inputMonitoring.settingsURL.absoluteString == base + "Privacy_ListenEvent")
        #expect(PermissionRow.accessibility.settingsURL.absoluteString == base + "Privacy_Accessibility")
        #expect(PermissionRow.automation(.spotify).settingsURL.absoluteString == base + "Privacy_Automation")
        #expect(PermissionRow.calendar.settingsURL.absoluteString == base + "Privacy_Calendars")
        #expect(PermissionRow.reminders.settingsURL.absoluteString == base + "Privacy_Reminders")
    }

    @Test func usageSaysWhenZenoUsesIt() {
        #expect(PermissionRow.microphone.usage == "Only while you hold the Talk keys or dictate")
        #expect(PermissionRow.accessibility.usage == "Only to type dictated text into the app you are in")
    }

    @Test func automationTargetsUseTheirBundleIds() {
        #expect(AutomationTarget.music.bundleId == "com.apple.Music")
        #expect(AutomationTarget.arc.bundleId == "company.thebrowser.Browser")
        #expect(AutomationTarget.brave.name == "Brave Browser")
    }

    // AVAuthorizationStatus and EKAuthorizationStatus raw values.
    @Test(arguments: [(0, PermissionState.notAsked), (1, .denied), (2, .denied), (3, .granted), (4, .denied), (99, .notAsked)])
    func authorizationStatusMapsToState(raw: Int, expected: PermissionState) {
        #expect(PermissionState.authorization(raw) == expected)
    }

    // IOHIDAccessType: granted, denied, unknown.
    @Test func listenAccessMapsToState() {
        #expect(PermissionState.listenAccess(0) == .granted)
        #expect(PermissionState.listenAccess(1) == .denied)
        #expect(PermissionState.listenAccess(2) == .notAsked)
    }

    @Test func accessibilityTrustMapsToState() {
        #expect(PermissionState.trusted(true) == .granted)
        #expect(PermissionState.trusted(false) == .denied)
    }

    @Test func automationAnswerMapsToState() {
        #expect(PermissionState.automation(0, installed: true) == .granted)
        #expect(PermissionState.automation(-1743, installed: true) == .denied)
        #expect(PermissionState.automation(-1744, installed: true) == .notAsked)
        // Not running: macOS cannot answer, which is not a refusal.
        #expect(PermissionState.automation(-600, installed: true) == .unchecked)
        #expect(PermissionState.automation(0, installed: false) == .notApplicable)
    }

    @Test func stateLinesArePlain() {
        #expect(PermissionState.granted.label == "Allowed")
        #expect(PermissionState.notAsked.label == "Not yet asked")
        #expect(PermissionRow.automation(.notes).stateLine(.unchecked) == "Not checked until Notes is open")
        #expect(PermissionRow.microphone.stateLine(.denied).contains("switch ZENO on"))
    }
}

@Suite("Setup and errors: plain error cards (ADR-075)")
struct PlainFailureTests {
    @Test func claudeNotSignedInOpensTerminalToSignIn() throws {
        // services/llm-gateway/src/providers/claude-plan.ts
        let f = try #require(PlainFailure.match("Claude Code is not signed in. Run `claude auth login` in a terminal, then try again."))
        #expect(f.action == .openTerminal(command: "claude auth login"))
        #expect(f.button == "Open Terminal")
    }

    @Test func claudeNotFoundShowsHowToInstall() throws {
        let f = try #require(PlainFailure.match("Claude Code was not found. Install it, then run `claude auth login` in a terminal."))
        guard case .showCommand(let text) = f.action else { Issue.record("expected showCommand"); return }
        #expect(text.contains("claude auth login"))
        // apps/mac/src/model-settings.ts, when switching to the plan without Claude Code.
        let switching = try #require(PlainFailure.match("Install Claude Code and run `claude auth login` to use Claude (my plan), then restart ZENO."))
        #expect(switching.sentence == f.sentence)
    }

    @Test(arguments: [
        "Invalid configuration:\n  - GEMINI_API_KEY is required (set it in .env)", // packages/shared/src/config.ts
        "Add GEMINI_API_KEY to .env to use Gemini, then restart ZENO.",               // apps/mac/src/model-settings.ts
    ])
    func missingKeyOffersAnotherModel(message: String) throws {
        let f = try #require(PlainFailure.match(message))
        #expect(f.action == .openModelSettings)
        #expect(f.button == "Choose another model")
        #expect(f.sentence == "There's no Gemini API key in .env.")
    }

    @Test func rejectedKeyNamesTheProvider() throws {
        // services/llm-gateway/src/providers/claude.ts
        let f = try #require(PlainFailure.match("Model key rejected (401). Check ANTHROPIC_API_KEY in .env."))
        #expect(f.sentence == "Claude rejected its API key.")
        #expect(f.action == .openModelSettings)
    }

    @Test func parakeetModelMissingSaysItDownloadsOnFirstUse() throws {
        // DictationController / DictationModel
        let f = try #require(PlainFailure.match(title: "Speech model missing", message: "The speech model could not be loaded (offline). It is downloaded on first use, so check the internet connection and try again."))
        guard case .showCommand(let text) = f.action else { Issue.record("expected showCommand"); return }
        #expect(text.contains("450 MB"))
        #expect(!text.contains("pnpm models"))
    }

    @Test func whisperModelMissingShowsTheDownloadCommand() throws {
        // apps/mac/src/stt.ts
        let message = #"Whisper model not found at "models/ggml-small.en.bin". Download it with: curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"#
        let f = try #require(PlainFailure.match(message))
        #expect(f.action == .showCommand("curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"))
        #expect(f.button == "How to download")
    }

    @Test func microphoneDeniedOpensItsPane() throws {
        let f = try #require(PlainFailure.match(title: "Microphone is off", message: "Allow ZENO under System Settings → Privacy & Security → Microphone."))
        #expect(f.action == .openSettingsPane(PermissionRow.microphone.settingsURL))
        #expect(f.button == "Open Settings")
        // apps/mac/src/audio.ts
        #expect(PlainFailure.match("ZENO is not allowed to use the microphone. Allow your terminal app in System Settings → Privacy & Security → Microphone, then restart it.")?.action == f.action)
    }

    @Test func unknownFailuresKeepTodaysText() {
        #expect(PlainFailure.match("Model limit reached. Try again in a minute.") == nil)
        #expect(PlainFailure.match(title: "Couldn't transcribe", message: "decoder failed") == nil)
    }

    @Test func gaveUpOffersRestartAndLog() throws {
        let f = try #require(PlainFailure.forStatus(.failed("ZENO's runtime keeps stopping: it exited with code 1")))
        #expect(f.action == .restartRuntime)
        #expect(f.offersLog)
        #expect(f.sentence == "ZENO stopped after crashing several times.")
    }

    @Test func configErrorUsesTheKnownSentenceAndRestarts() throws {
        let known = try #require(PlainFailure.forStatus(.configError("Invalid configuration:\n  - ANTHROPIC_API_KEY is required (set it in .env)")))
        #expect(known.sentence.hasPrefix("There's no Claude API key in .env."))
        #expect(known.action == .restartRuntime)
        #expect(known.offersLog)
        let other = try #require(PlainFailure.forStatus(.configError("Invalid configuration:\n  - ZENO_LOG_LEVEL must be one of …")))
        #expect(other.action == .restartRuntime)
        #expect(PlainFailure.forStatus(.running(pid: 1)) == nil)
        #expect(PlainFailure.forStatus(.restarting(after: 1)) == nil)
    }

    @Test func statusKeepsTheFailureUntilZenoRecovers() {
        var status = IslandStatus()
        status.apply(.error(RuntimeError(stage: "model", message: "Claude Code is not signed in. Run `claude auth login` in a terminal, then try again.", kind: "auth")))
        #expect(status.failure?.action == .openTerminal(command: "claude auth login"))
        // The full technical message stays for the Status tab.
        #expect(status.lastProblem?.message.contains("claude auth login") == true)
        status.apply(.state(.idle))
        #expect(status.failure != nil)
        status.apply(.state(.listening))
        #expect(status.failure == nil)

        status.apply(.failed("ZENO's runtime keeps stopping: boom"))
        #expect(status.failure?.action == .restartRuntime)
        status.apply(.running(pid: 2))
        #expect(status.failure == nil)

        status.apply(DictationPhase.done(.failed(title: "Microphone is off", message: "Allow ZENO under System Settings → Privacy & Security → Microphone.")))
        #expect(status.failure != nil)
        status.dismissFailure()
        #expect(status.failure == nil)

        status.apply(.error(RuntimeError(stage: "model", message: "Model limit reached.", kind: "rate_limit")))
        #expect(status.failure == nil)
    }
}

@Suite("Setup and errors: first-run tour (ADR-075)")
struct FirstRunTourTests {
    @Test func stepsGoHelloSayPointBackDone() {
        #expect(FirstRunTour.script.map(\.step) == [
            .hello,
            .say(title: "Hi, I'm Pal.", detail: "Hold Control + Option and talk to me."),
            .point(label: "Settings and our chats live here"),
            .back,
            .done,
        ])
        #expect(FirstRunTour.script.allSatisfy { $0.after >= 0 })
    }

    @Test func startsOnlyWithPalShownTheRuntimeReadyAndNotDone() {
        #expect(FirstRunTour.shouldStart(palShown: true, tourDone: false, runtimeReady: true))
        #expect(!FirstRunTour.shouldStart(palShown: false, tourDone: false, runtimeReady: true))
        #expect(!FirstRunTour.shouldStart(palShown: true, tourDone: true, runtimeReady: true))
        #expect(!FirstRunTour.shouldStart(palShown: true, tourDone: false, runtimeReady: false))
    }

    @Test func runsEachStepOnceThenStops() {
        var tour = FirstRunTour()
        #expect(!tour.isRunning)
        var seen: [TourStep] = []
        var step: TourStep? = tour.start()
        while let s = step {
            seen.append(s)
            step = tour.advance()
        }
        #expect(seen == FirstRunTour.script.map(\.step))
        #expect(!tour.isRunning)
        let after = tour.advance()
        #expect(after == nil)
    }

    @Test func talkingFirstEndsTheTour() {
        var tour = FirstRunTour()
        _ = tour.start()
        _ = tour.advance()
        let ended = tour.userTalked()
        #expect(ended)
        #expect(!tour.isRunning)
        #expect(tour.advance() == nil)
        let again = tour.userTalked()
        #expect(!again) // not running: nothing to end
    }

    @Test @MainActor func tourDoneIsStoredAndDefaultsToFalse() {
        let name = "zeno.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let settings = IslandSettings(defaults: defaults)
        #expect(!settings.tourDone)
        settings.tourDone = true
        #expect(defaults.bool(forKey: "zeno.tourDone"))
        #expect(IslandSettings(defaults: defaults).tourDone)
    }
}
