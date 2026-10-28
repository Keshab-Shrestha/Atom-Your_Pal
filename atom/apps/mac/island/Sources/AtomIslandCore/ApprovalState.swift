/// The one action ATOM is waiting on the user to allow or decline (ADR-054). Pure state: the views show
/// `pending` and call `answer`. A request never outlives its turn, so a stale prompt cannot approve a later action.
public struct ApprovalState: Sendable, Equatable {
    public private(set) var pending: ApprovalRequest?

    public init() {}

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .approvalRequest(let request):
            pending = request // the runtime sends one at a time; a newer one replaces an older
        case .approvalClosed(let id):
            if pending?.id == id { pending = nil }
        case .state(.idle), .conversationReset:
            pending = nil // the turn is over
        case .error(let error) where error.endsTurn:
            pending = nil
        default:
            break
        }
    }

    /// The runtime stopped or restarted: nothing it asked is still waiting.
    public mutating func runtimeStopped() {
        pending = nil
    }

    /// Takes the pending request and returns the command that answers it, or nil if nothing is waiting.
    public mutating func answer(approved: Bool, rememberFile: Bool = false, reviewToken: String? = nil) -> IslandCommand? {
        guard let request = pending else { return nil }
        if approved, let review = request.fileReview, review.token != reviewToken { return nil }
        pending = nil
        return .approvalAnswer(id: request.id, approved: approved, rememberFile: approved && request.fileReview == nil && request.rememberFile && rememberFile, reviewToken: approved ? reviewToken : nil)
    }
}
