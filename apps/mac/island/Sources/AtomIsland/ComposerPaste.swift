import AppKit
import SwiftUI
import AtomIslandCore

// ADR-125: ⌘V in the chat box attaches a copied file or a pasted image (a screenshot copied with ⌃⇧⌘4). Text pastes
// as before. SwiftUI's TextField gives no hook for paste, so a local key monitor sees ⌘V first, and acts only when
// this composer's field has focus in the window the key went to (the panel and the main window each have a composer).

/// Watches ⌘V for one composer.
@MainActor
final class ComposerPaste {
    /// The composer's field has keyboard focus.
    var focused = false
    /// The composer's window, read by `WindowProbe`.
    weak var window: NSWindow?
    private var monitor: Any?

    /// Starts watching; `attach` gets the paths to add. Calling it again replaces nothing.
    func start(attach: @escaping ([String]) -> Void) {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.focused, let window = self.window, event.window === window,
                  event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
                  event.charactersIgnoringModifiers == "v" else { return event }
            guard let paths = Self.attachable(from: .general) else { return event } // text: the field pastes it
            attach(paths)
            return nil
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    /// Paths to attach from the clipboard, or nil when it should paste as text.
    static func attachable(from board: NSPasteboard) -> [String]? {
        let urls = (board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        let hasText = board.string(forType: .string) != nil
        let hasImage = board.canReadObject(forClasses: [NSImage.self], options: nil)
        switch PasteChoice.choose(fileURLs: urls.map(\.path), hasText: hasText, hasImage: hasImage) {
        case .files(let paths): return paths
        case .text: return nil
        case .image:
            guard let image = NSImage(pasteboard: board), let path = save(image) else { return nil }
            return [path]
        }
    }

    /// Writes the image to the temp folder, PNG or (over the runtime's 10 MB) JPEG. Nil when it cannot be encoded.
    static func save(_ image: NSImage, now: Date = Date()) -> String? {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        let encoding = PastedImage.encoding(pngBytes: png.count)
        let data = encoding == .png ? png : bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85])
        guard let data else { return nil }
        let dir = PastedImage.directory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        PastedImage.removeOld(in: dir, now: now)
        let name = PastedImage.fileName(at: now, ext: encoding.ext)
        var url = dir.appendingPathComponent(name)
        // Two pastes in one second: "… (2).png".
        for n in 2...99 where FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent("\(name.dropLast(encoding.ext.count + 1)) (\(n)).\(encoding.ext)")
        }
        guard (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        return url.path
    }
}

/// Hands the window a view is in to `found` (an empty background view).
struct WindowProbe: NSViewRepresentable {
    let found: (NSWindow?) -> Void

    func makeNSView(context: Context) -> ProbeView { ProbeView(found: found) }
    func updateNSView(_ view: ProbeView, context: Context) { view.found = found }

    final class ProbeView: NSView {
        var found: (NSWindow?) -> Void
        init(found: @escaping (NSWindow?) -> Void) {
            self.found = found
            super.init(frame: .zero)
        }
        required init?(coder: NSCoder) { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            found(window)
        }
    }
}

/// The text view editing the key window's field now, if any.
@MainActor
enum FieldEditor {
    static var current: NSTextView? { NSApp.keyWindow?.firstResponder as? NSTextView }
    /// Japanese (or any) input is still being composed: Return belongs to the input method.
    static var composing: Bool { current?.hasMarkedText() ?? false }
}
