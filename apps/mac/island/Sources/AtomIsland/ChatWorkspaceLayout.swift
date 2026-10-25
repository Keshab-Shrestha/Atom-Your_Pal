import AppKit
import SwiftUI
import AtomIslandCore

/// Keep the conversation mounted when the workspace covers a narrow window; resizing cannot replace its editor.
struct ChatWorkspaceLayout<Header: View>: View {
    let model: IslandModel
    @ViewBuilder let header: () -> Header
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragWidth: Double?
    var body: some View {
        GeometryReader { geometry in
            let layout = WorkspacePaneLayout(available: geometry.size.width, preferred: dragWidth ?? model.settings.workspaceWidth)
            let shown = model.workspace.shown
            let covering = shown && !layout.split
            ZStack(alignment: .trailing) {
                VStack(spacing: 0) {
                    header()
                    ConversationTab(model: model)
                        .frame(maxWidth: .infinity)
                }
                    .workspaceLane(color: theme.surfaceSolid)
                    .padding(.trailing, shown && layout.split ? layout.pane + WorkspacePaneLayout.divider : 0)
                    .opacity(covering ? 0 : 1).allowsHitTesting(!covering).accessibilityHidden(covering)
                if shown {
                    HStack(spacing: 0) {
                        if layout.split {
                            WorkspaceDivider(width: layout.pane, maximum: geometry.size.width - WorkspacePaneLayout.minimumChat - WorkspacePaneLayout.divider,
                                             preview: { dragWidth = $0 }, commit: { model.settings.workspaceWidth = $0; dragWidth = nil })
                        }
                        ProjectWorkspaceView(model: model).frame(width: layout.pane)
                            .workspaceLane(color: WorkspaceColors.for(model.settings.theme).workspace)
                    }
                    .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                }
            }
            .onChange(of: shown) { dragWidth = nil }
            .animation(Motion.workspace(reduceMotion), value: shown)
        }
    }
}

private struct WorkspaceDivider: View {
    let width: Double
    let maximum: Double
    let preview: (Double) -> Void
    let commit: (Double) -> Void
    @Environment(\.theme) private var theme
    @State private var origin: Double?
    @State private var hovering = false
    private func bounded(_ value: Double) -> Double { min(maximum, WorkspacePaneLayout.preference(value)) }
    var body: some View {
        Capsule().fill(hovering || origin != nil ? theme.accent.color : theme.separator.color)
            .frame(width: 2, height: 48)
            .frame(width: WorkspacePaneLayout.divider, height: nil).frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .onHover { hovering = $0; ($0 ? NSCursor.resizeLeftRight : NSCursor.arrow).set() }
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global).onChanged { value in
                if origin == nil { origin = width }
                preview(bounded((origin ?? width) - value.translation.width))
            }.onEnded { value in
                commit(bounded((origin ?? width) - value.translation.width)); origin = nil
            })
            .focusable()
            .onKeyPress(.leftArrow) { commit(bounded(width + 40)); return .handled }
            .onKeyPress(.rightArrow) { commit(bounded(width - 40)); return .handled }
            .accessibilityLabel("Workspace divider")
            .accessibilityValue("\(Int(width)) pixels")
            .accessibilityHint("Left arrow widens the workspace; right arrow narrows it.")
            .accessibilityAdjustableAction { direction in
                switch direction { case .increment: commit(bounded(width + 40)); case .decrement: commit(bounded(width - 40)); @unknown default: break }
            }
            .contextMenu {
                Button("Widen workspace") { commit(bounded(width + 40)) }
                Button("Narrow workspace") { commit(bounded(width - 40)) }
                Button("Reset workspace width") { commit(420) }
            }
    }
}
