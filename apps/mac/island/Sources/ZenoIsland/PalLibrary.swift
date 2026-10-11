import Foundation
import ZenoIslandCore

/// ADR-089: the pals' characters (avatar definitions), each file read once. The folder: `ZENO_PALS_DIR` if set; in
/// ZENO.app its Resources/pals (build-app.sh copies `assets/pals`); in a development build the repo's `assets/pals`,
/// found above the executable or the working directory. An agent Keshab added gets Pal's shape in its own colours.
@MainActor
enum PalLibrary {
    static let directory: URL? = locate()
    private static var cache: [String: PalDefinition?] = [:]

    /// Pal itself.
    static var pal: PalDefinition? { definition("pal") }

    /// A worker's character; for an id with no file of its own, Pal's in colours chosen by the id.
    static func character(for id: String) -> PalDefinition? {
        if let own = definition(id) { return own }
        let colors = PalAnimation.agentColor(for: id)
        return pal?.recolored(body: colors.body, eyes: colors.eyes)
    }

    private static func definition(_ id: String) -> PalDefinition? {
        if let cached = cache[id] { return cached }
        let found = directory
            .flatMap { try? Data(contentsOf: $0.appendingPathComponent("\(id).json")) }
            .flatMap { try? PalDefinition.decode($0) }
        cache[id] = .some(found)
        return found
    }

    private static func locate() -> URL? {
        let fm = FileManager.default
        if let env = ProcessInfo.processInfo.environment["ZENO_PALS_DIR"], !env.isEmpty { return URL(fileURLWithPath: env, isDirectory: true) }
        if Bundle.main.bundleURL.pathExtension == "app" { return Bundle.main.resourceURL?.appendingPathComponent("pals", isDirectory: true) }
        let starts = [Bundle.main.executableURL?.deletingLastPathComponent(), URL(fileURLWithPath: fm.currentDirectoryPath)]
        for start in starts.compactMap({ $0?.standardizedFileURL }) {
            var folder = start
            while folder.pathComponents.count > 1 {
                let candidate = folder.appendingPathComponent("assets/pals", isDirectory: true)
                if fm.fileExists(atPath: candidate.appendingPathComponent("pal.json").path) { return candidate }
                folder.deleteLastPathComponent()
            }
        }
        return nil
    }
}
