// Development demos and snapshots, used by the gallery and the UI check (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Development demos

    func schedule(_ steps: [(Double, @MainActor () -> Void)]) {
        for (delay, step) in steps {
            let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { step() } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func note(_ label: String) {
        trace("demo \(label) | \(pet.debugState) | panel=\(current.map { "\($0)" } ?? "off") frame=\(panel.isVisible ? "\(panel.frame.integral)" : "-") window=\(helpersWindow.isVisible) | icon=\(menuIcon.anchor.map { "\(Int($0.midX))" } ?? "?")")
    }

    /// Development only (`ATOM_BUBBLE_DEMO=1`): plays a dictation's phases through the real controller, with no
    /// microphone and no keys, so the bubble's window can be measured on the real screen.
    func playBubbleDemo() {
        schedule([
            (4, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (6, { [self] in model.status.setPreview("send the deck before the call"); trace("demo preview") }),
            (9, { [self] in dictationPhase(.listeningHandsFree) }),
            (12, { [self] in dictationPhase(.transcribing) }),
            (14, { [self] in dictationPhase(.done(.typed(words: 6))) }),
        ])
    }

    /// Development only (`ATOM_WORK_DEMO=1`): a turn that works on the Mac, through the real event path: steps, an
    /// approval request (answered by the demo), a point at the top-right corner, then the end of the turn.
    func playWorkDemo() {
        let top = NSScreen.screens.first?.frame ?? .zero
        let corner = PointTarget(x: Double(top.width) - 70, y: 4, w: 40, h: 22, label: "the Control Centre icon")
        schedule([
            (3, { [self] in apply(.state(.thinking)); note("thinking") }),
            (4, { [self] in apply(.computerStep("Looking at TextEdit")); note("step 1") }),
            (6, { [self] in apply(.computerStep("Typing in TextEdit")); note("step 2") }),
            (8, { [self] in apply(.approvalRequest(ApprovalRequest(id: "demo", summary: "Press return in TextEdit", reason: "it uses the Return key"))); note("asking") }),
            (12, { [self] in apply(.approvalClosed(id: "demo")); note("answered") }),
            (13, { [self] in apply(.computerPoint(corner)); note("pointing top-right") }),
            (18, { [self] in note("pointed") }),
            (19, { [self] in apply(.state(.speaking)) }),
            (21, { [self] in apply(.state(.idle)); note("turn over") }),
            (22, { [self] in note("lingering") }),
            (25, { [self] in note("strip gone") }),
        ])
    }

    /// Development only (`ATOM_POINT_DEMO="x,y,w,h,label;x,y,w,h,label"`): plays each place through the real event path,
    /// 11 s apart, as the runtime would send them (Cua's coordinates: points, origin top-left of the main display).
    func playPointDemo(_ spots: String) {
        for (index, spot) in spots.split(separator: ";").enumerated() {
            let parts = spot.split(separator: ",", maxSplits: 4).map(String.init)
            guard parts.count == 5, let x = Double(parts[0]), let y = Double(parts[1]), let w = Double(parts[2]), let h = Double(parts[3]) else { continue }
            let target = PointTarget(x: x, y: y, w: w, h: h, label: parts[4])
            schedule([(3 + Double(index) * 11, { [self] in
                trace("demo point \(target.label)")
                apply(.state(.thinking))
                apply(.computerPoint(target))
                apply(.state(.idle))
            })])
        }
    }

    /// Development only (`ATOM_LOOK_DEMO`): changes the look settings while the app runs, so the real windows can
    /// be measured, then puts the user's own values back.
    func playLookDemo() {
        let settings = model.settings
        let saved = (settings.palSize, settings.bubbleSize, settings.bubbleOpacity, settings.bubbleStay)
        func look(_ label: String) {
            trace("look \(label) | pal=\(Int(settings.palSize.points)) | panel frame=\(Int(panel.frame.width))x\(Int(panel.frame.height)) visible=\(panel.isVisible) | bubble=\(bubble.isVisible)")
        }
        schedule([
            (3, { look("start") }),
            (4, { settings.palSize = .huge }),
            (5.5, { look("pal huge") }),
            (6, { settings.bubbleSize = .large; settings.bubbleOpacity = .solid }),
            (6.5, { [self] in model.meter.reset(); dictationPhase(.listening) }),
            (8, { look("bubble large while listening") }),
            (9, { [self] in dictationPhase(.cancelled) }),
            (10, { settings.palSize = .small; settings.bubbleSize = .normal }),
            (11, { look("pal small") }),
            (18.5, {
                (settings.palSize, settings.bubbleSize, settings.bubbleOpacity, settings.bubbleStay) = saved
                look("restored")
            }),
        ])
    }

    // MARK: - Development snapshots

    func snapshotSoon() {
        guard snapshotDirectory != nil else { return }
        // Long enough for some mic levels to arrive while listening.
        let timer = Timer(timeInterval: 0.6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.writeSnapshot() }
        }
        RunLoop.main.add(timer, forMode: .common)
    }

    func writeSnapshot() {
        guard let directory = snapshotDirectory else { return }
        let size = layout().size(current ?? .compact)
        let renderer = ImageRenderer(content: IslandView(model: model, snapshot: true).frame(width: size.width, height: size.height))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        snapshotCount += 1
        let name = String(format: "%02d-%@.png", snapshotCount, model.status.title.replacingOccurrences(of: " ", with: "-"))
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? png.write(to: directory.appendingPathComponent(name))
    }
}
