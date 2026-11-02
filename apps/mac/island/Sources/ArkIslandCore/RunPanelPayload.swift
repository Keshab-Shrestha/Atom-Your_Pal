import Foundation

/// The data of the Run panel, from a chat's work snapshot (docs/web-panel-contract.md). Only the contract's fields go to
/// the page. A question's answer and error can hold what the user typed or a path, so they never go. Pipeline, lanes
/// and evidence are not in the runtime's events yet; the page is told so.
public enum RunPanelPayload {
    public static let maxCalls = 200
    public static let maxQuestions = 50
    public static let maxString = 500
    public static let maxBytes = 256 * 1024
    public static let unavailable = ["pipeline", "lanes", "evidence"]

    public static func make(_ snapshot: ChatWorkSnapshot) -> [String: Any] {
        var calls = snapshot.calls.prefix(maxCalls).map(callObject)
        let questions = snapshot.questions.prefix(maxQuestions).map { question -> [String: Any] in
            ["id": cut(question.id), "prompt": cut(question.prompt), "state": cut(question.state)]
        }
        var omitted = snapshot.omitted + max(0, snapshot.calls.count - maxCalls)
        func build() -> [String: Any] {
            [
                "chat": cut(snapshot.chat), "turn": cut(snapshot.turn), "state": cut(snapshot.state),
                "elapsedMs": snapshot.elapsedMs.isFinite ? snapshot.elapsedMs : 0,
                "calls": calls, "omitted": omitted, "questions": questions, "unavailable": unavailable,
            ]
        }
        var payload = build()
        // Calls that do not fit go last-first and are counted as omitted.
        while !calls.isEmpty, size(payload) > maxBytes {
            let drop = max(1, calls.count / 8)
            calls.removeLast(drop)
            omitted += drop
            payload = build()
        }
        return payload
    }

    private static func callObject(_ call: ChatWorkSnapshot.Call) -> [String: Any] {
        let time: Any = call.ms.flatMap { $0.isFinite ? $0 : nil } ?? NSNull()
        return ["id": cut(call.id), "tool": cut(call.tool), "state": cut(call.state), "ms": time]
    }

    private static func cut(_ text: String) -> String { String(text.prefix(maxString)) }

    private static func size(_ payload: [String: Any]) -> Int {
        (try? JSONSerialization.data(withJSONObject: payload).count) ?? Int.max
    }
}
