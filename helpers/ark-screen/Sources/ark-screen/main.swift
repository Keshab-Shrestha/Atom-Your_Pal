import AppKit
import ApplicationServices
import ArkScreenCore
import Foundation
import ScreenCaptureKit
import UniformTypeIdentifiers

struct ScreenError: Error, CustomStringConvertible { let description: String }

@MainActor final class MarkerWindow {
    private var window: NSWindow?
    func show(x: Double, y: Double, seconds: Double) {
        window?.orderOut(nil)
        let size: CGFloat = 36
        let height = NSScreen.screens.first?.frame.height ?? 0 // top-left origin (points) to AppKit bottom-left
        let frame = NSRect(x: x - size / 2, y: height - y - size / 2, width: size, height: size)
        let w = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false; w.backgroundColor = .clear; w.ignoresMouseEvents = true; w.level = .screenSaver; w.hasShadow = false
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        let ring = NSView(frame: NSRect(origin: .zero, size: frame.size))
        ring.wantsLayer = true
        ring.layer?.cornerRadius = size / 2
        ring.layer?.borderWidth = 3
        ring.layer?.borderColor = NSColor.systemOrange.cgColor
        ring.layer?.backgroundColor = NSColor.systemOrange.withAlphaComponent(0.2).cgColor
        w.contentView = ring
        w.orderFrontRegardless()
        window = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            if self?.window === w { w.orderOut(nil); self?.window = nil }
        }
    }
}

enum Shared { @MainActor static let marker = MarkerWindow() }

final class RealScreen: ScreenSystem, @unchecked Sendable {
    func size() -> (width: Double, height: Double) {
        let b = CGDisplayBounds(CGMainDisplayID())
        return (b.width, b.height)
    }

    func screenshot(to path: String) async throws -> (width: Int, height: Int) {
        guard CGPreflightScreenCaptureAccess() else { throw ScreenError(description: "Screen Recording is not allowed for ARK. Allow it in System Settings, Privacy and Security.") }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw ScreenError(description: "No display.") }
        let config = SCStreamConfiguration()
        config.width = display.width * 2
        config.height = display.height * 2
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: config)
        guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw ScreenError(description: "The file cannot be written.") }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { throw ScreenError(description: "The PNG could not be written.") }
        return (image.width, image.height)
    }

    func tree(pid: Int?, depth: Int, max: Int) throws -> [Node] {
        guard AXIsProcessTrusted() else { throw ScreenError(description: "Accessibility is not allowed for ARK. Allow it in System Settings, Privacy and Security.") }
        guard let target = pid.map(pid_t.init) ?? NSWorkspace.shared.frontmostApplication?.processIdentifier else { throw ScreenError(description: "No front app.") }
        var nodes: [Node] = []
        func walk(_ element: AXUIElement, _ level: Int) {
            guard nodes.count < max else { return }
            func string(_ key: String) -> String {
                var v: CFTypeRef?
                return AXUIElementCopyAttributeValue(element, key as CFString, &v) == .success ? (v as? String ?? "") : ""
            }
            var origin = CGPoint.zero, extent = CGSize.zero
            var p: CFTypeRef?, s: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &p) == .success, let p { AXValueGetValue(p as! AXValue, .cgPoint, &origin) }
            if AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &s) == .success, let s { AXValueGetValue(s as! AXValue, .cgSize, &extent) }
            let title = [string(kAXTitleAttribute), string(kAXDescriptionAttribute), string(kAXValueAttribute)].first { !$0.isEmpty } ?? ""
            nodes.append(Node(depth: level, role: string(kAXRoleAttribute), title: String(title.prefix(80)), x: origin.x, y: origin.y, width: extent.width, height: extent.height))
            guard level < depth else { return }
            var kids: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &kids) == .success, let list = kids as? [AXUIElement] {
                for child in list { walk(child, level + 1) }
            }
        }
        walk(AXUIElementCreateApplication(target), 0)
        return nodes
    }

    func marker(x: Double, y: Double, seconds: Double) async {
        await MainActor.run { Shared.marker.show(x: x, y: y, seconds: seconds) }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let screen = RealScreen()
let out = FileHandle.standardOutput

Thread.detachNewThread {
    while let line = readLine() {
        let (request, problem) = Request.parse(line)
        guard let request else {
            if let problem { out.write(Data((Wire.failure(id: 0, problem) + "\n").utf8)) }
            continue
        }
        let done = DispatchSemaphore(value: 0) // one request at a time
        Task {
            out.write(Data((await Wire.respond(to: request, using: screen) + "\n").utf8))
            done.signal()
        }
        done.wait()
    }
    exit(0)
}
app.run()
