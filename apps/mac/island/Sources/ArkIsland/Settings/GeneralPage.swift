import AppKit
import SwiftUI
import ArkIslandCore

/// Open at login and the tour (ADR-097: the sounds moved to Settings → Sounds). The rest of what this page held now sits
/// under the page that names its purpose: Computer, Notifications, Connections and Privacy. Each page with choices has its own reset (ADR-079).
struct GeneralSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let settings = model.settings
        let login = model.loginItem
        Card { OwnerNameRow(model: model) } // ADR-271
        Card(footer: loginFooter(login)) {
            Row(title: "Open at login", detail: "Start ARK when you log in to this Mac") {
                ThemedSwitch(isOn: login.enabled || login.needsApproval, set: { login.set($0) }, label: "Open at login")
                    .disabled(!login.available)
            }
            if login.needsApproval || login.error != nil {
                RowDivider()
                Row(title: "Needs your OK in System Settings") {
                    PillButton(title: "Open…") { login.openSystemSettings() }
                }
            }
            RowDivider()
            Row(title: "Run routines and workflows while ARK is closed", detail: "A macOS login item opens ARK in the background a minute before a routine or a scheduled workflow is due. ARK then stays open.") {
                ThemedSwitch(isOn: settings.wakeForRoutines, set: { settings.wakeForRoutines = $0; model.wakeChanged() }, label: "Run routines and workflows while ARK is closed")
                    .disabled(Bundle.main.bundleURL.pathExtension != "app")
            }
            RowDivider()
            Row(title: "Answer without keys", detail: "Off: one turn, then ARK waits. On: after a spoken question it listens for a few seconds") {
                ThemedSwitch(isOn: settings.followUpEnabled, set: { settings.followUpEnabled = $0 }, label: "Answer without keys")
            }
        }
        .onAppear { login.refresh(); model.updater.check() }
        if model.updater.isSourceCopy { UpdateCard(updater: model.updater) }
        // 2026-11-06: which build runs, so "is this the new one?" is never a guess. "+" means the build had changes not yet committed.
        Card {
            Row(title: "This build", detail: BuildInfo.line) { EmptyView() }
        }
        Card(footer: "Opens GitHub with only the ARK and macOS versions filled in. No log or chat is attached.") {
            Row(title: "Report a problem", detail: "Tell us what went wrong") {
                PillButton(title: "Report…") {
                    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development"
                    if let url = ProblemReport.url(arkVersion: version, macOS: ProcessInfo.processInfo.operatingSystemVersionString) { NSWorkspace.shared.open(url) }
                }
            }
        }
        Card(footer: settings.petEnabled ? nil : "Turn on ARK to see the tour.") {
            Row(title: "Replay the tour", detail: "ARK shows where to talk and where your settings live") {
                PillButton(title: "Replay") { model.replayTour() }
                    .disabled(!settings.petEnabled)
            }
        }
    }
}

@MainActor private func loginFooter(_ login: LoginItem) -> String? {
    if !login.available { return "Available when ARK runs as an app (pnpm island:open)." }
    return login.error
}

/// ARK updates (2026-11-04): shows what waits on GitHub and updates on a click. ARK reopens when the build ends.
private struct UpdateCard: View {
    let updater: AppUpdater

    var body: some View {
        Card(footer: footer) {
            Row(title: title, detail: detail) {
                if updater.updating {
                    Text("Updating…").appFont(.system(size: 12)).foregroundStyle(.secondary)
                } else if case .available? = updater.status {
                    PillButton(title: "Update", prominent: true) { updater.update() }
                } else {
                    PillButton(title: updater.checking ? "Checking…" : "Check") { updater.check(force: true) }.disabled(updater.checking)
                }
            }
        }
    }

    private var title: String { "ARK updates" }

    private var detail: String {
        if updater.updating { return "Pulling the changes and building. ARK reopens when it is done, in a few minutes." }
        switch updater.status {
        case nil: return updater.checking ? "Looking at GitHub…" : "Check for new versions of ARK."
        case .upToDate?: return "This copy is up to date."
        case .available(let count, _)?: return count == 1 ? "1 change is ready." : "\(count) changes are ready."
        case .blocked(let why)?, .failed(let why)?: return why
        case .notASourceCopy?: return "This copy was not built from source."
        }
    }

    private var footer: String? {
        if case .available(_, let subjects)? = updater.status, !subjects.isEmpty { return subjects.map { "• " + $0 }.joined(separator: "\n") }
        return nil
    }
}

/// The running build: version, commit and build time, from the app's Info.plist (written by build-app.sh). "development" outside it.
enum BuildInfo {
    static var line: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "development"
        let commit = info["ARKBuildCommit"] as? String
        let built = (info["CFBundleVersion"] as? String).flatMap { stamp -> String? in
            let f = DateFormatter(); f.dateFormat = "yyyyMMddHHmm"
            return f.date(from: stamp)?.formatted(date: .abbreviated, time: .shortened)
        }
        return [version, commit.map { "commit \($0)" }, built.map { "built \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }
}
