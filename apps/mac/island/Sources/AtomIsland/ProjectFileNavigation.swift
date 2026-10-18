import AppKit
import Foundation
import AtomIslandCore

/// ADR-153/154: metadata-only UI navigation within the runtime's current project. Host tool checks remain authoritative.
enum ProjectFileNavigation {
    struct Entry: Sendable, Equatable, Identifiable {
        let relative: String
        let path: String
        var id: String { path }
    }
    struct Search: Sendable {
        var files: [Entry] = []
        var limited = false
        var unavailable = false
    }
    private static let skipped = Set(["node_modules", "vendor", "build", "dist", "target", "Pods", "DerivedData"])

    private static func safeParts(_ parts: [String]) -> Bool {
        parts.allSatisfy { part in
            let lower = part.lowercased()
            return !part.isEmpty && !part.hasPrefix(".") && !part.contains("`")
                && HiddenCharacters.strip(part).removed == 0
                && !part.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
                && !lower.hasSuffix(".pem") && !lower.hasPrefix("id_rsa") && !lower.hasPrefix("id_ed25519")
        }
    }

    static func root(_ project: ProjectInfo?) -> URL? {
        guard let project, !project.missing, !project.archived, project.folderPath.hasPrefix("/") else { return nil }
        let root = URL(fileURLWithPath: project.folderPath).standardizedFileURL
        // A replaced/symlinked project root needs reopening through the normal project controls.
        guard root.resolvingSymlinksInPath().path == root.path else { return nil }
        let home = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
        if root.path.hasPrefix(home + "/") {
            let parts = String(root.path.dropFirst(home.count + 1)).components(separatedBy: "/")
            guard parts.first?.lowercased() != "library", safeParts(parts) else { return nil }
        } else {
            let parts = root.pathComponents
            guard parts.count >= 4, parts[1] == "Volumes", safeParts(Array(parts.dropFirst(2))) else { return nil }
        }
        guard let values = try? root.resourceValues(forKeys: [.isDirectoryKey]), values.isDirectory == true else { return nil }
        return root
    }

    static func resolve(_ candidate: String, project: ProjectInfo?) -> Entry? {
        guard let root = root(project), !candidate.isEmpty, candidate.utf8.count <= 4096 else { return nil }
        var path = candidate
        guard !path.contains("://") || path.hasPrefix("file://") else { return nil }
        // File references may include :line or :line:column. Finder selects the file, not an editor position.
        for _ in 0..<2 {
            if let colon = path.lastIndex(of: ":"), !path[path.index(after: colon)...].isEmpty,
               path[path.index(after: colon)...].allSatisfy(\.isNumber) { path = String(path[..<colon]) }
        }
        if path.hasPrefix("file:") {
            guard let url = URL(string: path), url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost" else { return nil }
            path = url.path
        }
        if path.hasPrefix("~/") { path = (path as NSString).expandingTildeInPath }
        guard HiddenCharacters.strip(path).removed == 0,
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        // Do not accept traversal, even when normalization would end up inside the project.
        guard !path.components(separatedBy: "/").contains("..") else { return nil }
        let url = (path.hasPrefix("/") ? URL(fileURLWithPath: path) : root.appendingPathComponent(path)).standardizedFileURL
        guard url.path.hasPrefix(root.path + "/"), url.resolvingSymlinksInPath().path == url.path else { return nil }
        let relative = String(url.path.dropFirst(root.path.count + 1))
        guard safeParts(relative.components(separatedBy: "/")),
              let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true else { return nil }
        return Entry(relative: relative, path: url.path)
    }

    static func search(project: ProjectInfo, query: String) -> Search {
        guard let root = root(project), let walker = FileManager.default.enumerator(at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return Search(unavailable: true) }
        var result = Search()
        var visited = 0
        let deadline = Date().addingTimeInterval(0.3)
        for case let url as URL in walker {
            if Task.isCancelled { return Search() }
            if visited >= 5000 || Date() >= deadline { result.limited = true; break }
            visited += 1
            let parts = String(url.path.dropFirst(root.path.count + 1)).components(separatedBy: "/")
            guard safeParts(parts), !skipped.contains(url.lastPathComponent),
                  let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]),
                  values.isSymbolicLink != true else { walker.skipDescendants(); continue }
            guard values.isRegularFile == true else { continue }
            let relative = parts.joined(separator: "/")
            guard query.isEmpty || relative.localizedStandardContains(query) else { continue }
            if let entry = resolve(relative, project: project) { result.files.append(entry) }
            if result.files.count >= 200 { result.limited = true; break }
        }
        result.files.sort { $0.relative.localizedStandardCompare($1.relative) == .orderedAscending }
        if result.files.count > 6 { result.limited = true; result.files = Array(result.files.prefix(6)) }
        return result
    }

    /// Bounded syntactic candidates; existence/containment is checked separately, including again on click.
    static func references(_ text: String) -> [String] {
        let pattern = #"`([^`\n]+)`|\[[^\]\n]*\]\(([^)\n]+)\)|(?<![\w:/])((?:\.{0,2}/|~/|/)?[A-Za-z0-9_@.-]+(?:/[A-Za-z0-9_@.+-]+)+(?::[0-9]+(?::[0-9]+)?)?)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let source = String(text.prefix(64_000)) as NSString
        var found: [String] = []
        regex.enumerateMatches(in: source as String, range: NSRange(location: 0, length: source.length)) { match, _, stop in
            guard let match else { return }
            for group in 1...3 where match.range(at: group).location != NSNotFound {
                let value = source.substring(with: match.range(at: group))
                if !found.contains(value) { found.append(value) }
            }
            if found.count >= 24 { stop.pointee = true }
        }
        return found
    }

    @MainActor static func reveal(_ entry: Entry, project: ProjectInfo?) -> Bool {
        guard let current = resolve(entry.relative, project: project), current.path == entry.path else { return false }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: current.path)])
        return true
    }
}
