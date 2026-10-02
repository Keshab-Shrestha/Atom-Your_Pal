import Observation
import ZenoIslandCore

/// Everything the island's views show, and the actions they can take. Owned by `IslandController`.
@MainActor @Observable
final class IslandModel {
    enum Tab: String, CaseIterable, Identifiable {
        case conversation = "Conversation"
        case status = "Status"
        case settings = "Settings"
        var id: String { rawValue }

        var symbol: String {
            switch self {
            case .conversation: "bubble.left.and.text.bubble.right"
            case .status: "gauge.with.dots.needle.33percent"
            case .settings: "gearshape"
            }
        }
    }

    var status = IslandStatus()
    var meter = LevelMeter(bars: 14)
    var conversation = Conversation()
    /// The model in use and the choices, from the runtime's `info` event.
    var modelInfo: ModelInfo?
    /// A model switch sent to the runtime and not yet confirmed (model id).
    var pendingModel: String?
    /// Why the last model switch was refused, shown under the model list until the next attempt.
    var modelError: String?

    var expanded = false
    var tab = Tab.conversation

    let settings: IslandSettings
    let recorder: ShortcutRecorder

    /// Sends a command to the runtime. Set by the app.
    @ObservationIgnored var send: (IslandCommand) -> Void = { _ in }
    /// Opens or closes the expanded view. Set by the controller.
    @ObservationIgnored var setExpanded: (Bool) -> Void = { _ in }

    init(settings: IslandSettings) {
        self.settings = settings
        recorder = ShortcutRecorder(settings: settings)
    }

    func chooseModel(provider: String, model: String) {
        guard modelInfo?.provider != provider || modelInfo?.model != model else { return }
        pendingModel = model
        modelError = nil
        send(.modelSet(provider: provider, model: model))
    }

    func newConversation() {
        send(.conversationReset)
    }

    /// Keeps the conversation and model list in step with the runtime. The status is applied by the controller.
    func apply(_ event: IslandEvent) {
        conversation.apply(event)
        switch event {
        case .info(let info):
            modelInfo = info
            pendingModel = nil
            modelError = nil
        case .error(let error) where error.stage == "settings":
            pendingModel = nil
            modelError = error.message
        default:
            break
        }
    }
}
