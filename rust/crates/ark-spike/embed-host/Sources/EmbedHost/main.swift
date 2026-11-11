// A SwiftUI window with Rune's text check inside it, drawn by rune::embed::LayerHost through
// the C functions in rust/crates/ark-spike/src/embed.rs. Keys go through AppKit's text input
// system (interpretKeyEvents), so the input method, dictation and the emoji picker reach Rune
// as marked text and commits.
import AppKit
import QuartzCore
import SwiftUI

@_silgen_name("ark_embed_new") func arkEmbedNew(_ layer: UnsafeMutableRawPointer, _ w: Float, _ h: Float, _ scale: Float) -> OpaquePointer?
@_silgen_name("ark_embed_frame") func arkEmbedFrame(_ host: OpaquePointer?) -> Bool
@_silgen_name("ark_embed_resize") func arkEmbedResize(_ host: OpaquePointer?, _ w: Float, _ h: Float, _ scale: Float)
@_silgen_name("ark_embed_pointer") func arkEmbedPointer(_ host: OpaquePointer?, _ kind: Int32, _ x: Float, _ y: Float)
@_silgen_name("ark_embed_key") func arkEmbedKey(_ host: OpaquePointer?, _ text: UnsafePointer<CChar>, _ command: Bool)
@_silgen_name("ark_embed_ime") func arkEmbedIme(_ host: OpaquePointer?, _ kind: Int32, _ text: UnsafePointer<CChar>)

final class RuneView: NSView, NSTextInputClient {
    private var host: OpaquePointer?
    private var timer: Timer?
    private var marked = ""

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }
    required init?(coder: NSCoder) { nil }

    override func makeBackingLayer() -> CALayer { CAMetalLayer() }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        guard let window, host == nil, let layer else { return }
        let scale = Float(window.backingScaleFactor)
        layer.contentsScale = window.backingScaleFactor
        host = arkEmbedNew(Unmanaged.passUnretained(layer).toOpaque(), Float(bounds.width), Float(bounds.height), scale)
        window.makeFirstResponder(self)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self))
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { _ = arkEmbedFrame(self?.host) }
        }
    }

    override func setFrameSize(_ size: NSSize) {
        super.setFrameSize(size)
        arkEmbedResize(host, Float(size.width), Float(size.height), Float(window?.backingScaleFactor ?? 2))
    }

    private func pointer(_ kind: Int32, _ event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        arkEmbedPointer(host, kind, Float(p.x), Float(p.y))
    }
    override func mouseMoved(with event: NSEvent) { pointer(0, event) }
    override func mouseDragged(with event: NSEvent) { pointer(0, event) }
    override func mouseDown(with event: NSEvent) { window?.makeFirstResponder(self); pointer(1, event) }
    override func mouseUp(with event: NSEvent) { pointer(2, event) }
    override func keyDown(with event: NSEvent) { interpretKeyEvents([event]) }
    override func doCommand(by selector: Selector) { arkEmbedKey(host, NSStringFromSelector(selector), true) }

    // NSTextInputClient: just enough for marked text (preedit) and commits.
    func insertText(_ string: Any, replacementRange: NSRange) {
        let text = (string as? NSAttributedString)?.string ?? (string as? String) ?? ""
        if marked.isEmpty { arkEmbedKey(host, text, false) } else { arkEmbedIme(host, 1, text) }
        marked = ""
    }
    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        marked = (string as? NSAttributedString)?.string ?? (string as? String) ?? ""
        arkEmbedIme(host, 0, marked)
    }
    func unmarkText() { marked = "" }
    func selectedRange() -> NSRange { NSRange(location: 0, length: 0) }
    func markedRange() -> NSRange { marked.isEmpty ? NSRange(location: NSNotFound, length: 0) : NSRange(location: 0, length: marked.utf16.count) }
    func hasMarkedText() -> Bool { !marked.isEmpty }
    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? { nil }
    func validAttributesForMarkedText() -> [NSAttributedString.Key] { [] }
    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        // ponytail: fixed spot under the single-line field; a real host asks Rune for the caret rect.
        window?.convertToScreen(convert(NSRect(x: 24, y: 100, width: 1, height: 18), to: nil)) ?? .zero
    }
    func characterIndex(for point: NSPoint) -> Int { 0 }
}

struct RuneEmbed: NSViewRepresentable {
    func makeNSView(context: Context) -> RuneView { RuneView(frame: NSRect(x: 0, y: 0, width: 560, height: 640)) }
    func updateNSView(_ view: RuneView, context: Context) {}
}

struct Root: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SwiftUI host: the Rune view is below").font(.headline).padding([.top, .horizontal])
            RuneEmbed().frame(width: 560, height: 640)
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 690), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "ARK spike: embed host"
    window.contentView = NSHostingView(rootView: Root())
    window.setFrameOrigin(NSPoint(x: 200, y: 200)) // on the primary display (its origin is 0, 0)
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    app.run()
}
