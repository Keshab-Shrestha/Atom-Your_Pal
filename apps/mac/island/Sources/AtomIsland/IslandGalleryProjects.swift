import AppKit
import SwiftUI
import AtomIslandCore

extension IslandGallery {
    /// ADR-107: the sidebar's Projects: the empty state, a project opened to its chats, a name being changed, a project
    /// whose folder is gone and an archived one; then an open project chat with its chip and the long-chat note.
    static func writeProjects(to directory: URL, theme: AppTheme = .void, name: String = "16-projects") {
        let suite = "atom.gallery.projects.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let palette = theme.palette
        func ago(_ minutes: Double) -> String {
            ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutes * 60))
        }
        func chat(_ id: String, _ title: String, _ minutes: Double, project: String? = nil) -> String {
            #"{"id":"\#(id)","title":"\#(title)","updatedAt":"\#(ago(minutes))","messages":4\#(project.map { #","projectId":"\#($0)""# } ?? "")}"#
        }
        let haat = #"{"id":"p1","name":"Haat","folderLabel":"~/Developer/haat","missing":false,"archived":false,"chatCount":12,"web":false,"agent":"haat-coder"}"#
        let site = #"{"id":"p2","name":"Portfolio site","folderLabel":"~/Sites/portfolio","missing":true,"archived":false,"chatCount":2,"web":true}"#
        let notes = #"{"id":"p3","name":"Old notes","folderLabel":"~/Documents/notes","missing":false,"archived":true,"chatCount":1,"web":false}"#
        let haatChats = (0..<12).map { chat("h\($0)", ["Fix the checkout total", "Why is the cart slow?", "Add Nepali labels", "Plan the seller page", "Review the OTP flow", "Explain the order model", "Image upload limits", "Khalti test mode", "Ward picker bug", "Refund wording", "Slow network test", "Search ranking"][$0], Double(20 + $0 * 70), project: "p1") }
        let plain = [chat("c1", "Plan a weekend in Kyoto", 5), chat("c2", "What's on my calendar tomorrow?", 120)]
        func event(projects: String?, chats: [String], current: String = "c1", currentProject: String? = nil) -> IslandEvent? {
            let p = projects.map { #","projects":[\#($0)]"# } ?? ""
            let cp = currentProject.map { #","currentProjectId":"\#($0)""# } ?? ""
            return try? decodeEvent(#"{"type":"chats","current":"\#(current)","chats":[\#(chats.joined(separator: ","))]\#(p)\#(cp)}"#)
        }
        func model(_ projects: String?, _ chats: [String], current: String = "c1", currentProject: String? = nil) -> IslandModel {
            let m = IslandModel(settings: IslandSettings(defaults: defaults))
            m.settings.theme = theme
            if let e = event(projects: projects, chats: chats, current: current, currentProject: currentProject) { m.apply(e) }
            return m
        }
        func sidebar(_ title: String, _ m: IslandModel, _ section: ProjectsSection) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                VStack(alignment: .leading, spacing: 4) {
                    section
                    ChatsPreview(list: m.chats)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(width: 224, height: 640, alignment: .top)
                .background(Rectangle().fill(palette.surfaceFill(solid: true)))
                .environment(\.islandSnapshot, true).themed(palette)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        let emptyModel = model("", plain)
        let open = model("\(haat),\(site),\(notes)", plain + haatChats, current: "h0", currentProject: "p1")
        let many = model("\(haat),\(site),\(notes)", plain + haatChats)
        let archived = model("\(haat),\(site),\(notes)", plain + haatChats)
        let chatting = model("\(haat),\(site)", plain + haatChats, current: "h0", currentProject: "p1")
        chatting.windowPage = .chat
        chatting.conversation.replay([ChatLine(fromUser: true, text: "Why is the checkout total off by a rupee?"),
                                      ChatLine(fromUser: false, text: "The tax is rounded per line, then summed. Rounding the sum once fixes it. The code is in src/cart/total.ts.")])
        if let e = try? decodeEvent(#"{"type":"chat.opened","id":"h0","projectId":"p1","trimmed":true,"messages":[]}"#) { chatting.apply(e) }
        chatting.conversation.replay([ChatLine(fromUser: true, text: "Why is the checkout total off by a rupee?"),
                                      ChatLine(fromUser: false, text: "The tax is rounded per line, then summed. Rounding the sum once fixes it. The code is in src/cart/total.ts.")])
        let failing = model("\(haat),\(site)", plain + haatChats)
        failing.projectError = "A project with this name exists"
        let sheet = VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                sidebar("Empty state", emptyModel, ProjectsSection(model: emptyModel))
                sidebar("Haat open: 10 chats, Show more; a missing folder; archived hidden", open, ProjectsSection(model: open, expanded: ["p1"]))
                sidebar("Inline rename of Haat", many, ProjectsSection(model: many, renaming: "p1"))
            }
            HStack(alignment: .top, spacing: 18) {
                sidebar("Archived shown, a refused name", failing, ProjectsSection(model: failing, expanded: ["p2"]))
                sidebar("Archived shown", archived, ProjectsSection(model: archived, showArchived: true))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("A project chat: chip in the top bar, the long-chat note").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.75))
                frozen(HelpersView(model: chatting).environment(\.islandSnapshot, true).frame(width: 720, height: 520))
                    .clipShape(RoundedRectangle(cornerRadius: palette.isFlat ? 24 : 16, style: .continuous))
            }
        }
        .padding(24)
        .background(Color(red: 0.36, green: 0.42, blue: 0.52))
        save(sheet, name: name, to: directory)
    }
}

/// The plain chats under the Projects section, as the sidebar draws them, for the gallery.
private struct ChatsPreview: View {
    let list: ChatList?
    @Environment(\.theme) private var theme

    var body: some View {
        Text("Chats").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color).padding(.horizontal, 10).padding(.top, 8)
        ForEach(list?.plainChats.prefix(2).map { $0 } ?? []) { chat in
            Text(chat.title).font(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(1)
                .padding(.horizontal, 10).padding(.vertical, 6)
        }
    }
}
