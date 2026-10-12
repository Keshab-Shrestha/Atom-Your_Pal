import Foundation

/// How to start the ZENO runtime: `node --env-file-if-exists=.env --disable-warning=ExperimentalWarning apps/mac/src/main.ts --island`
/// in the project folder.
public struct RuntimeLaunch: Sendable, Equatable {
    public var executable: URL
    public var arguments: [String]
    public var directory: URL
    public var environment: [String: String]

    public init(executable: URL, arguments: [String], directory: URL, environment: [String: String]) {
        self.executable = executable
        self.arguments = arguments
        self.directory = directory
        self.environment = environment
    }
}

public enum LocateError: Error, Equatable, CustomStringConvertible {
    case projectNotFound(tried: [String])
    case nodeNotFound(tried: [String])
    case nodeTooOld(path: String, version: String)

    public var description: String {
        switch self {
        case .projectNotFound(let tried):
            "ZENO's project folder was not found (looked in: \(tried.joined(separator: ", "))). " +
                "Rebuild ZENO.app from the project folder, or set ATOM_PROJECT_ROOT."
        case .nodeNotFound(let tried):
            "Node.js was not found (looked in: \(tried.joined(separator: ", "))). " +
                "Install it with `brew install node`, or set ATOM_NODE to its path."
        case .nodeTooOld(let path, let version):
            "Node.js at \(path) is \(version); ZENO needs \(RuntimeLocator.minimumNode.text) or newer. " +
                "Update it with `brew upgrade node`, or set ATOM_NODE to a newer one."
        }
    }
}

/// A Node.js version, e.g. 22.18.0.
public struct NodeVersion: Comparable, Sendable {
    public var major: Int, minor: Int, patch: Int

    public init(_ major: Int, _ minor: Int, _ patch: Int) {
        (self.major, self.minor, self.patch) = (major, minor, patch)
    }

    /// Parses `node --version` output such as "v22.18.0".
    public init?(parsing text: String) {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .drop(while: { $0 == "v" })
            .split(separator: ".")
            .map { Int($0.prefix(while: \.isNumber)) }
        guard parts.count >= 2, let major = parts[0], let minor = parts[1] else { return nil }
        self.init(major, minor, parts.count > 2 ? parts[2] ?? 0 : 0)
    }

    public var text: String { "v\(major).\(minor).\(patch)" }

    public static func < (a: NodeVersion, b: NodeVersion) -> Bool {
        (a.major, a.minor, a.patch) < (b.major, b.minor, b.patch)
    }
}

/// Finds the project folder and a suitable Node.js. Inputs are injected so the search can be tested.
public struct RuntimeLocator {
    /// Node runs ZENO's TypeScript directly (type stripping), available from 22.18.
    public static let minimumNode = NodeVersion(22, 18, 0)
    /// The runtime's entry point, relative to the project folder; its presence identifies the folder.
    public static let entryPoint = "apps/mac/src/main.ts"

    public var environment: [String: String]
    /// Values recorded in Info.plist at build time (`AtomProjectRoot`, `AtomNodePath`).
    public var bundleInfo: [String: String]
    public var homeDirectory: String
    public var isExecutable: (String) -> Bool
    public var fileExists: (String) -> Bool
    /// Runs `node --version`; nil if it could not be run.
    public var nodeVersion: (String) -> String?
    /// The Calendar and Reminders helper (ADR-060), when there is one: `atom-calendar` next to the app's binary.
    public var calendarHelper: String?

    public init(
        environment: [String: String],
        bundleInfo: [String: String],
        homeDirectory: String,
        isExecutable: @escaping (String) -> Bool,
        fileExists: @escaping (String) -> Bool,
        nodeVersion: @escaping (String) -> String?,
        calendarHelper: String? = nil
    ) {
        self.calendarHelper = calendarHelper
        self.environment = environment
        self.bundleInfo = bundleInfo
        self.homeDirectory = homeDirectory
        self.isExecutable = isExecutable
        self.fileExists = fileExists
        self.nodeVersion = nodeVersion
    }

    /// Where Homebrew and common installers put command-line tools. An app started from Finder gets
    /// only /usr/bin:/bin:/usr/sbin:/sbin, but the runtime needs ffmpeg and whisper-cli by name.
    public static let toolDirectories = ["/opt/homebrew/bin", "/usr/local/bin"]

    public func locate() throws -> RuntimeLaunch {
        let root = try projectRoot()
        let node = try nodePath()
        return RuntimeLaunch(
            executable: URL(fileURLWithPath: node),
            arguments: ["--env-file-if-exists=.env", "--disable-warning=ExperimentalWarning", Self.entryPoint, "--island"],
            directory: URL(fileURLWithPath: root, isDirectory: true),
            environment: runtimeEnvironment(node: node))
    }

    func projectRoot() throws -> String {
        let candidates = [AtomEnv.read("ATOM_PROJECT_ROOT", environment), bundleInfo["AtomProjectRoot"]].compactMap { $0 }.filter { !$0.isEmpty }
        for root in candidates where fileExists((root as NSString).appendingPathComponent(Self.entryPoint)) {
            return root
        }
        throw LocateError.projectNotFound(tried: candidates)
    }

    func nodePath() throws -> String {
        let candidates = unique([
            AtomEnv.read("ATOM_NODE", environment),
            bundleInfo["AtomNodePath"],
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "\(homeDirectory)/.local/bin/node",
            "\(homeDirectory)/.volta/bin/node",
        ].compactMap { $0 }.filter { !$0.isEmpty })

        var tooOld: LocateError?
        for path in candidates where isExecutable(path) {
            guard let text = nodeVersion(path), let version = NodeVersion(parsing: text) else { continue }
            if version >= Self.minimumNode { return path }
            tooOld = tooOld ?? .nodeTooOld(path: path, version: version.text)
        }
        throw tooOld ?? LocateError.nodeNotFound(tried: candidates)
    }

    func runtimeEnvironment(node: String) -> [String: String] {
        var env = environment
        let nodeDir = (node as NSString).deletingLastPathComponent
        let existing = (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
        env["PATH"] = unique([nodeDir] + Self.toolDirectories + existing).joined(separator: ":")
        // ADR-060: the Calendar and Reminders helper next to the app's own binary, so permission is ZENO's.
        if AtomEnv.read("ATOM_CALENDAR_HELPER", env) == nil, let helper = calendarHelper, isExecutable(helper) {
            env["ATOM_CALENDAR_HELPER"] = helper
        }
        return env
    }

    private func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0).inserted }
    }
}

extension RuntimeLocator {
    /// The locator for the running app: real environment, Info.plist and file system.
    public static func live(bundle: Bundle = .main) -> RuntimeLocator {
        let info = (bundle.infoDictionary ?? [:]).compactMapValues { $0 as? String }
        let fm = FileManager.default
        return RuntimeLocator(
            environment: ProcessInfo.processInfo.environment,
            bundleInfo: info,
            homeDirectory: fm.homeDirectoryForCurrentUser.path,
            isExecutable: { fm.isExecutableFile(atPath: $0) },
            fileExists: { fm.fileExists(atPath: $0) },
            nodeVersion: { path in
                let process = Process()
                process.executableURL = URL(fileURLWithPath: path)
                process.arguments = ["--version"]
                let out = Pipe()
                process.standardOutput = out
                process.standardError = FileHandle.nullDevice
                do { try process.run() } catch { return nil }
                let data = out.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                return process.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
            },
            calendarHelper: bundle.executableURL.map { $0.deletingLastPathComponent().appendingPathComponent("atom-calendar").path })
    }
}
