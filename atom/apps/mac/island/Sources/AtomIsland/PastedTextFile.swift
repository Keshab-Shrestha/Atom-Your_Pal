import Foundation
import Darwin
import AtomIslandCore

/// ADR-150: private durable bytes for an explicitly pasted attachment; no automatic submission or pruning.
enum PastedTextFile {
    enum Failure: Error { case tooLarge, unavailable }

    static func save(_ text: String) throws -> String {
        let data = Data(text.utf8)
        guard !data.isEmpty, data.count <= PastedImage.maxBytes else { throw Failure.tooLarge }
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ATOM/PastedText", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let dir = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard dir >= 0 else { throw Failure.unavailable }
        defer { Darwin.close(dir) }
        var info = stat()
        guard fstat(dir, &info) == 0, info.st_uid == getuid(), fchmod(dir, 0o700) == 0 else { throw Failure.unavailable }
        let name = "Pasted text \(UUID().uuidString).txt"
        let fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.unavailable }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var saved = false
        defer {
            try? handle.close()
            if !saved { unlinkat(dir, name, 0) }
        }
        try handle.write(contentsOf: data)
        try handle.synchronize()
        saved = true
        return directory.appendingPathComponent(name).path
    }
}
