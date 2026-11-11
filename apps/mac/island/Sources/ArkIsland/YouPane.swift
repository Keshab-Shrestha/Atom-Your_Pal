import AppKit
import SwiftUI
import ArkIslandCore

/// You (2026-11-02, after the Company page of Keshab's reference): one page about the owner. Who you are on this Mac, what ARK
/// remembers, your setup, your activity and your connections. It only reads; each card links to the page that changes it.
struct YouPane: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 20) {
                header
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                    remembers
                    setup
                    activity
                    connections
                }
            }
            .padding(24)
        }
        .onAppear { if model.memory == nil, !snapshot { model.loadMemory() } }
    }

    /// The owner's name (ADR-271): the saved one, else the Mac user's full name (snapshots: a fixed sample).
    private var name: String { snapshot ? "Keshab Shrestha" : model.settings.ownerName ?? NSFullUserName() }

    private var header: some View {
        HStack(spacing: 16) {
            YouAvatar(name: name, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(name.isEmpty ? "You" : name).appFont(theme.pageTitleFont(24)).foregroundStyle(theme.text.color)
                Text("Owner · \(snapshot ? "This Mac" : Host.current().localizedName ?? "This Mac") · \(snapshot ? "Asia/Tokyo" : TimeZone.current.identifier)")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
            }
        }
    }

    private var remembers: some View {
        let memory = model.memory
        return card("What ARK remembers", symbol: "brain.head.profile", action: ("Manage", { model.navigate { model.windowPage = .brain } })) {
            if let memory, memory.enabled {
                Text(memory.count == 1 ? "1 fact" : "\(memory.count) facts").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color)
                ForEach(memory.memories.prefix(5)) { item in
                    Text("• " + item.text).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(2)
                }
                if memory.memories.isEmpty { Text("Nothing yet. Say \"remember …\" in a chat.").appFont(.system(size: 12)).foregroundStyle(theme.text3.color) }
            } else {
                Text(memory == nil ? "Loading…" : "Memory is off.").appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
            }
        }
    }

    private var setup: some View {
        let s = model.settings
        return card("Your setup", symbol: "slider.horizontal.3", action: ("Change", { model.openSettings(.defaults) })) {
            row("Theme", s.theme.title)
            row("Typeface", s.typeface.title)
            row("New chats", "\(s.newChatAccess.title) · \(s.newChatEffort.title)")
            row("Opens on", s.startPage.title)
        }
    }

    private var activity: some View {
        let chats = model.chats?.chats ?? []
        let agents = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" }
        let streak = ActivityStreak.days(chats.compactMap(\.updatedAt))
        return card("Activity", symbol: "chart.bar", action: ("Dashboard", { model.navigate { model.windowPage = .dashboard } })) {
            row("Chats", "\(chats.count)")
            row("Agents", "\(agents.count)")
            row("Workflows", model.workflows.map { "\($0.workflows.count)" } ?? "—")
            row("Tokens this week", model.helpers.list?.usage.map { TokenTotals.short($0.week.io) } ?? "—")
            row("Active days in a row", "\(streak)")
        }
    }

    private var connections: some View {
        card("Connections", symbol: "link", action: ("Settings", { model.openSettings(.connections) })) {
            row("Telegram", model.telegramConnected ? "Connected" : "Off")
            row("Local API", model.settings.localApi ? "On" : "Off")
            row("Computer control", model.computerOn ? "On" : "Off")
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).appFont(.system(size: 12.5)).foregroundStyle(theme.text2.color)
            Spacer(minLength: 8)
            Text(value).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
        }
    }

    private func card(_ title: String, symbol: String, action: (String, () -> Void), @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(title, systemImage: symbol).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Spacer()
                Button(action.0, action: action.1).buttonStyle(.plain).appFont(.system(size: 12)).foregroundStyle(theme.accent.color)
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
    }
}

/// The owner's initials in a disc, as the reference's account footer shows them.
struct YouAvatar: View {
    let name: String
    let size: CGFloat
    @Environment(\.theme) private var theme

    var body: some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        Text(initials.isEmpty ? "Y" : initials.uppercased())
            .appFont(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(theme.onAccent.color)
            .frame(width: size, height: size).background(Circle().fill(theme.accent.color))
            .accessibilityHidden(true)
    }
}
