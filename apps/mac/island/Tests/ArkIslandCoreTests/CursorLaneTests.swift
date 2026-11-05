import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Cursor lanes (ADR-249)") struct CursorLaneTests {
    @Test func aCursorEventMayNameALane() throws {
        guard case .computerCursor(let x, let y, let lane) = try decodeEvent(#"{"type":"computer.cursor","x":10,"y":20,"lane":"notes"}"#) else { Issue.record("not a cursor"); return }
        #expect(x == 10 && y == 20 && lane == "notes")
        guard case .computerCursor(_, _, let none) = try decodeEvent(#"{"type":"computer.cursor","x":1,"y":2}"#) else { Issue.record("not a cursor"); return }
        #expect(none == nil, "the main lane has no name")
    }
}
