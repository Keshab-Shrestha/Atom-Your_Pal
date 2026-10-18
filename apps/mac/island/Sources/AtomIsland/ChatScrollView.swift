import AppKit
import SwiftUI

/// ADR-147: follow layout changes only until the reader scrolls away. Snapshot rendering stays flat.
struct ChatScrollView<Content: View>: View {
    let turnIDs: [Int]
    var suspendFollowing = false
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot
    private let away = State(initialValue: false)
    private let jump = State(initialValue: 0)

    var body: some View {
        VStack(spacing: 0) {
            Scrollable {
                content.background {
                    if !snapshot {
                        ChatScrollProbe(turnIDs: turnIDs, jump: jump.wrappedValue, suspended: suspendFollowing) {
                            away.wrappedValue = $0
                        }
                    }
                }
            }
            .softEdges()
            // Outside the scroll viewport, so the button cannot cover a message or its copy controls.
            if away.wrappedValue && !snapshot && !suspendFollowing {
                Button {
                    jump.wrappedValue += 1
                } label: {
                    Label("Scroll to end", systemImage: "arrow.down.to.line")
                }
                .buttonStyle(.borderless)
                .font(.system(size: 12))
                .padding(.vertical, 6)
                .accessibilityHint("Show the latest messages and follow new replies")
            }
        }
    }
}

/// Observe only this transcript's native scroll view. No event monitor or provider/model state is needed.
private struct ChatScrollProbe: NSViewRepresentable {
    let turnIDs: [Int]
    let jump: Int
    let suspended: Bool
    let changed: (Bool) -> Void

    func makeNSView(context: Context) -> Probe { Probe(frame: .zero) }

    func updateNSView(_ view: Probe, context: Context) {
        view.changed = changed
        if view.suspended != suspended {
            view.suspended = suspended
            if suspended { view.pause() }
        }
        let replayed = !view.turnIDs.isEmpty && !turnIDs.isEmpty
            && !view.turnIDs.contains(where: turnIDs.contains)
        let requested = view.jump != jump
        view.turnIDs = turnIDs
        view.jump = jump
        if replayed || requested { view.resume() }
        // SwiftUI may not have put this background into its scroll view yet.
        DispatchQueue.main.async { [weak view] in view?.attach() }
    }

    static func dismantleNSView(_ view: Probe, coordinator: ()) {
        view.mounted = false
        view.detach()
    }

    final class Probe: NSView {
        var changed: ((Bool) -> Void)?
        var turnIDs: [Int] = []
        var jump = 0
        var mounted = true
        var suspended = false
        private weak var scroll: NSScrollView?
        private var following = true
        private var adjusting = false
        private var pending = false
        private var geometry: NSRect = .zero
        private var viewport: NSSize = .zero
        private var origin: NSPoint = .zero
        private var reportedAway = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }

        func attach() {
            guard mounted, let found = enclosingScrollView, found !== scroll,
                  let document = found.documentView else { return }
            detach()
            scroll = found
            document.postsFrameChangedNotifications = true
            found.contentView.postsBoundsChangedNotifications = true
            found.contentView.postsFrameChangedNotifications = true
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(layoutChanged), name: NSView.frameDidChangeNotification, object: document)
            center.addObserver(self, selector: #selector(layoutChanged), name: NSView.frameDidChangeNotification, object: found.contentView)
            center.addObserver(self, selector: #selector(boundsChanged), name: NSView.boundsDidChangeNotification, object: found.contentView)
            center.addObserver(self, selector: #selector(userWillScroll), name: NSScrollView.willStartLiveScrollNotification, object: found)
            center.addObserver(self, selector: #selector(userScrolled), name: NSScrollView.didLiveScrollNotification, object: found)
            center.addObserver(self, selector: #selector(userScrolled), name: NSScrollView.didEndLiveScrollNotification, object: found)
            rememberGeometry()
            report(force: true)
            scheduleFollow()
        }

        func detach() {
            NotificationCenter.default.removeObserver(self)
            scroll = nil
        }

        func resume() {
            following = true
            report()
            scheduleFollow()
        }

        func pause() {
            following = false
            report()
        }

        private func rememberGeometry() {
            guard let scroll, let document = scroll.documentView else { return }
            geometry = document.frame
            viewport = scroll.contentView.bounds.size
            origin = scroll.contentView.bounds.origin
        }

        private var atEnd: Bool {
            guard let scroll, let document = scroll.documentView else { return true }
            let visible = scroll.contentView.bounds
            if document.isFlipped { return document.bounds.maxY - visible.maxY <= 2 }
            return visible.minY - document.bounds.minY <= 2
        }

        @objc private func layoutChanged() {
            rememberGeometry()
            scheduleFollow()
        }

        @objc private func boundsChanged() {
            guard let scroll, let document = scroll.documentView else { return }
            let resized = geometry != document.frame || viewport != scroll.contentView.bounds.size
            let moved = origin.y != scroll.contentView.bounds.origin.y
            rememberGeometry()
            guard !adjusting else { return }
            if resized {
                scheduleFollow()
            } else if moved && !pending {
                // Includes keyboard, scroller and accessibility scrolling, without capturing keystrokes.
                following = atEnd
                report()
            }
        }

        @objc private func userWillScroll() {
            // A gesture takes priority over a follow already queued for the next layout pass.
            following = false
        }

        @objc private func userScrolled() {
            guard !adjusting else { return }
            following = atEnd
            rememberGeometry()
            report()
        }

        private func report(force: Bool = false) {
            let value = !following
            guard force || value != reportedAway else { return }
            reportedAway = value
            // Never mutate SwiftUI state in its layout/update pass; discard superseded reports.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.scroll != nil, self.reportedAway == value else { return }
                self.changed?(value)
            }
        }

        private func scheduleFollow() {
            guard following, !pending, !suspended else { return }
            pending = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.pending = false
                guard self.following, !self.suspended, let scroll = self.scroll, let document = scroll.documentView else { return }
                let clip = scroll.contentView
                let y = document.isFlipped
                    ? max(document.bounds.minY, document.bounds.maxY - clip.bounds.height)
                    : document.bounds.minY
                self.adjusting = true
                clip.scroll(to: NSPoint(x: clip.bounds.minX, y: y))
                scroll.reflectScrolledClipView(clip)
                self.rememberGeometry()
                self.adjusting = false
            }
        }
    }
}
