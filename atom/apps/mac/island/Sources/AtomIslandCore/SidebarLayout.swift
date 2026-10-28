import Foundation

/// The pages in the ATOM window's left sidebar that Keshab can put in any order (2026-10-15). The Chats list and the
/// Projects section are not here: they stay where they are. Needs you and Issues moved into the Board (a saved order that
/// still names them loads: unknown names are dropped).
public enum SidebarItem: String, CaseIterable, Sendable {
    case dashboard, board, scheduled, brain, plugins, settings
}

/// Where the sidebar's pages sit: the `top` group above Projects and Chats, and the `bottom` group below them. A page can
/// be dragged to any place in either group. Every page is in exactly one group, always, so none can be lost.
public struct SidebarLayout: Sendable, Equatable {
    public private(set) var top: [SidebarItem]
    public private(set) var bottom: [SidebarItem]

    /// The order ATOM starts with.
    public static let standard = SidebarLayout(top: [.dashboard, .board, .scheduled, .brain], bottom: [.plugins, .settings])

    /// Any lists: a page named twice keeps its first place, and a page left out goes back to the end of its standard group.
    public init(top: [SidebarItem], bottom: [SidebarItem]) {
        var seen = Set<SidebarItem>()
        let cleanTop = top.filter { seen.insert($0).inserted }
        let cleanBottom = bottom.filter { seen.insert($0).inserted }
        let standardTop: [SidebarItem] = [.dashboard, .board, .scheduled, .brain]
        let missing = SidebarItem.allCases.filter { !seen.contains($0) }
        self.top = cleanTop + missing.filter { standardTop.contains($0) }
        self.bottom = cleanBottom + missing.filter { !standardTop.contains($0) }
    }

    /// Moves a page into the top or the bottom group, before `target` (a page in that group), or to the end of the group
    /// when `target` is nil or is not in it.
    public mutating func move(_ item: SidebarItem, before target: SidebarItem?, toBottom: Bool) {
        guard item != target else { return }
        top.removeAll { $0 == item }
        bottom.removeAll { $0 == item }
        var group = toBottom ? bottom : top
        if let target, let index = group.firstIndex(of: target) { group.insert(item, at: index) } else { group.append(item) }
        if toBottom { bottom = group } else { top = group }
    }

    /// Moves a page onto `target`, in the group that holds `target` (a drag over a row). Dragged down over a page in its own
    /// group, it goes after that page, so it can pass it; otherwise it goes before it.
    public mutating func move(_ item: SidebarItem, onto target: SidebarItem) {
        guard item != target else { return }
        let toBottom = bottom.contains(target)
        let group = toBottom ? bottom : top
        if let from = group.firstIndex(of: item), let to = group.firstIndex(of: target), from < to {
            move(item, before: group.indices.contains(to + 1) ? group[to + 1] : nil, toBottom: toBottom)
        } else {
            move(item, before: target, toBottom: toBottom)
        }
    }

    /// One place up (`step` -1) or down (+1) inside its own group: the menu's Move up and Move down.
    public mutating func shift(_ item: SidebarItem, by step: Int) {
        let toBottom = bottom.contains(item)
        var group = toBottom ? bottom : top
        guard let from = group.firstIndex(of: item), group.indices.contains(from + step) else { return }
        group.swapAt(from, from + step)
        if toBottom { bottom = group } else { top = group }
    }

    /// How it is stored: "dashboard,inbox,…|plugins,settings".
    public var storage: String {
        top.map(\.rawValue).joined(separator: ",") + "|" + bottom.map(\.rawValue).joined(separator: ",")
    }

    /// From a stored value; anything unreadable gives the standard order.
    public init(storage: String?) {
        guard let storage else { self = .standard; return }
        let groups = storage.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        func items(_ text: String) -> [SidebarItem] { text.split(separator: ",").compactMap { SidebarItem(rawValue: String($0)) } }
        self.init(top: items(groups.first ?? ""), bottom: groups.count > 1 ? items(groups[1]) : [])
    }
}
