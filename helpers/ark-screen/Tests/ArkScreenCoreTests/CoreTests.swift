import XCTest
@testable import ArkScreenCore

struct FakeScreen: ScreenSystem {
    var fail = false
    func size() -> (width: Double, height: Double) { (1440, 900) }
    func screenshot(to path: String) async throws -> (width: Int, height: Int) {
        if fail { throw NSError(domain: "x", code: 1, userInfo: [NSLocalizedDescriptionKey: "denied"]) }
        return (2880, 1800)
    }
    func tree(pid: Int?, depth: Int, max: Int) throws -> [Node] {
        [Node(depth: 0, role: "AXWindow", title: "Notes", x: 0, y: 25, width: 800, height: 600), Node(depth: 1, role: "AXButton", title: "Save\nAs", x: 10, y: 30, width: 80, height: 24)]
    }
    func marker(x: Double, y: Double, seconds: Double) async {}
}

final class CoreTests: XCTestCase {
    func testRequestsParseAndClamp() {
        XCTAssertEqual(Request.parse(#"{"id":1,"cmd":"size"}"#).0, Request(id: 1, kind: .size))
        XCTAssertEqual(Request.parse(#"{"id":2,"cmd":"tree","depth":99,"max":99999}"#).0, Request(id: 2, kind: .tree(pid: nil, depth: Request.maxDepth, max: Request.maxNodes)))
        XCTAssertEqual(Request.parse(#"{"id":3,"cmd":"marker","x":5,"y":6.5,"seconds":0}"#).0, Request(id: 3, kind: .marker(x: 5, y: 6.5, seconds: 0.2)))
        XCTAssertNotNil(Request.parse(#"{"id":4,"cmd":"screenshot","path":"rel.png"}"#).error)
        XCTAssertNotNil(Request.parse(#"{"id":5,"cmd":"click"}"#).error)
        XCTAssertNil(Request.parse("nonsense").0)
    }

    func testRepliesCarryTheId() async {
        let s = FakeScreen()
        let shot = await Wire.respond(to: Request(id: 7, kind: .screenshot(path: "/tmp/a.png")), using: s)
        XCTAssertEqual(shot, #"{"height":1800,"id":7,"ok":true,"path":"\/tmp\/a.png","width":2880}"#)
        let tree = await Wire.respond(to: Request(id: 8, kind: .tree(pid: nil, depth: 3, max: 10)), using: s)
        XCTAssertTrue(tree.contains(#""text":"AXWindow \"Notes\" (0,25 800x600)\n  AXButton \"Save As\" (10,30 80x24)""#), tree)
        let bad = await Wire.respond(to: Request(id: 9, kind: .screenshot(path: "/x.png")), using: FakeScreen(fail: true))
        XCTAssertTrue(bad.contains(#""ok":false"#) && bad.contains(#""id":9"#))
    }
}
