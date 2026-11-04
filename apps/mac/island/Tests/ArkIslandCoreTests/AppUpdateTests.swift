import Foundation
import Testing
@testable import ArkIslandCore

@Suite("App update")
struct AppUpdateTests {
    @Test("a source copy is found from the app's place; any other place is not one")
    func root() {
        let app = URL(fileURLWithPath: "/Users/me/ARK/apps/mac/island/build/ARK.app")
        #expect(AppUpdate.sourceRoot(bundle: app)?.path == "/Users/me/ARK")
        #expect(AppUpdate.sourceRoot(bundle: URL(fileURLWithPath: "/Applications/ARK.app")) == nil)
        #expect(AppUpdate.sourceRoot(bundle: URL(fileURLWithPath: "/Users/me/ARK/apps/mac/island/.build/debug/ARK")) == nil)
    }

    @Test("status: another branch or own changes block; none behind is up to date; behind lists the first lines")
    func status() {
        #expect(AppUpdate.status(branch: "feature", dirty: false, behind: 3, subjects: []) == .blocked("This copy is on the branch “feature”, not “main”. Update it by hand."))
        #expect(AppUpdate.status(branch: "main", dirty: true, behind: 3, subjects: []) == .blocked("This copy has changes of its own. Update it by hand so they are not lost."))
        #expect(AppUpdate.status(branch: "main", dirty: false, behind: 0, subjects: ["x"]) == .upToDate)
        let subjects = (1...8).map { "change \($0)" } + [""]
        #expect(AppUpdate.status(branch: "main", dirty: false, behind: 9, subjects: subjects) == .available(count: 9, subjects: (1...5).map { "change \($0)" }))
    }

    @Test("the update line is fast-forward only, quotes a path with a quote in it, and logs to a file")
    func command() {
        let line = AppUpdate.updateCommand(root: URL(fileURLWithPath: "/Users/o'neil/ARK"))
        #expect(line.contains("cd '/Users/o'\\''neil/ARK'"))
        #expect(line.contains("git pull --ff-only && sh scripts/setup.sh"))
        #expect(line.hasSuffix("> logs/update.log 2>&1"))
    }
}
