import AppKit
import ZenoIslandCore

/// The avatar images (ADR-085), each file read once and kept. A missing file is remembered as missing, so
/// `image` returns nil and the caller draws today's Wisp or helper mark. Which file a moment shows is
/// `AvatarExpression` (ZenoIslandCore).
///
/// The folder: `ZENO_AVATARS_DIR` if set (development, e.g. placeholder images); in ZENO.app its own
/// Resources/avatars (build-app.sh copies `assets/avatars` there); in a development build the repo's
/// `assets/avatars`, found above the executable or the working directory.
@MainActor
enum AvatarImages {
    static let directory: URL? = locate()
    private static var cache: [String: NSImage?] = [:]

    /// The image for `expression`, or the first of its fallbacks that exists; nil when none does.
    static func image(_ character: String, _ expression: AvatarExpression) -> NSImage? {
        for candidate in expression.fallbacks {
            if let image = load(character, candidate) { return image }
        }
        return nil
    }

    /// Wisp's avatar images exist: the Avatar style is offered, and is the default (ADR-085).
    static var hasWisp: Bool { load("wisp", .neutral) != nil }

    private static func load(_ character: String, _ expression: AvatarExpression) -> NSImage? {
        guard let directory, let path = expression.path(character: character) else { return nil }
        if let cached = cache[path] { return cached }
        let image = NSImage(contentsOf: directory.appendingPathComponent(path))
        cache[path] = .some(image)
        return image
    }

    private static func locate() -> URL? {
        let fm = FileManager.default
        if let env = ProcessInfo.processInfo.environment["ZENO_AVATARS_DIR"], !env.isEmpty {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        if Bundle.main.bundleURL.pathExtension == "app" {
            return Bundle.main.resourceURL?.appendingPathComponent("avatars", isDirectory: true)
        }
        let starts = [Bundle.main.executableURL?.deletingLastPathComponent(), URL(fileURLWithPath: fm.currentDirectoryPath)]
        for start in starts.compactMap({ $0?.standardizedFileURL }) {
            var folder = start
            while folder.pathComponents.count > 1 {
                let candidate = folder.appendingPathComponent("assets/avatars", isDirectory: true)
                var isFolder: ObjCBool = false
                if fm.fileExists(atPath: candidate.path, isDirectory: &isFolder), isFolder.boolValue { return candidate }
                folder.deleteLastPathComponent()
            }
        }
        return nil
    }
}
