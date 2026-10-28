import SwiftUI
import AtomIslandCore

/// The Run surface of the workspace pane (ADR-211): the tool calls and questions of the chat's latest turn, shown by
/// the bundled Run panel. It is read-only. The data is the runtime's own work snapshot; nothing here asks the model.
struct RunSurfaceView: View {
    let model: IslandModel
    @State private var revision = 0

    var body: some View {
        let work = model.conversation.turns.last?.work
        WebPanelView(
            panel: "run", label: "Run",
            data: work.map { WebPanelData(revision: revision, payload: RunPanelPayload.make($0)) },
            resetKey: model.chats?.current ?? "",
            background: WorkspaceColors.for(model.settings.theme).workspace
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The page ignores a revision that is not higher, so each new snapshot raises it.
        .onChange(of: work) { revision += 1 }
    }
}
