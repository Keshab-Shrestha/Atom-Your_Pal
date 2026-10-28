// Screens and Spaces: where the panel, the strip and Pal go (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Displays and Spaces

    /// The panel hangs from the icon; if the icon's place is unknown, from the top-right of the main display.
    func layout() -> MenuPanelLayout {
        let metrics = IslandMetrics()
        if let anchor = menuIcon.anchor {
            return MenuPanelLayout(screen: anchor.screen.frame, menuBarBottom: Self.menuBarBottom(of: anchor.screen), iconMidX: anchor.midX, metrics: metrics)
        }
        guard let screen = NSScreen.screens.first else {
            return MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1440, height: 900), metrics: metrics)
        }
        return MenuPanelLayout(screen: screen.frame, menuBarBottom: Self.menuBarBottom(of: screen), metrics: metrics)
    }

    /// The bottom of the menu bar. `visibleFrame` also excludes a Dock on the left or right, so only its top is used.
    static func menuBarBottom(of screen: NSScreen) -> CGFloat {
        let fromVisible = screen.visibleFrame.maxY
        // A menu bar that hides itself: the visible frame reaches the top. Keep below where it appears.
        if fromVisible >= screen.frame.maxY {
            return screen.frame.maxY - max(NSStatusBar.system.thickness, screen.safeAreaInsets.top)
        }
        return fromVisible
    }

    /// Re-applies the look settings whenever one changes (the bubble and the panel; Pal reads its own each frame).
    func watchSettings() {
        withObservationTracking {
            _ = model.settings.revision
        } onChange: { [weak self] in
            // `onChange` fires just before the value changes, on whichever thread changed it: look again next turn.
            Task { @MainActor [weak self] in
                self?.applyLook()
                self?.watchSettings()
            }
        }
    }

    func applyLook() {
        bubble.lookChanged()
        panel.hasShadow = model.settings.theme.palette.usesShadows
        menuIcon.update(model.status.kind, title: model.status.title, flat: !model.settings.theme.palette.usesGlow)
        guard let current, panel.isVisible else { return }
        let target = layout().frame(current)
        guard target != panel.frame else { return }
        trace("panel size \(Int(target.width))x\(Int(target.height))")
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            panel.animator().setFrame(target, display: true)
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated { self?.settleShadow() }
        })
    }

    /// The window's shadow is traced from what the panel drew when it was last computed. Re-trace it once the
    /// panel has its final size and corners (a stale trace from the smaller status card, or from mid-animation, shows
    /// as a squared-off edge around the rounded panel). After the content's own cross-fade.
    func settleShadow() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.panel.isVisible else { return }
                self.panel.display()
                self.panel.invalidateShadow()
            }
        }
    }

    func screensChanged() {
        trace("screens changed")
        if let current, panel.isVisible { panel.setFrame(layout().frame(current), display: true) }
        refresh()
    }

    func spaceChanged() {
        if panel.isVisible { panel.orderFrontRegardless() }
        strip.bringToFront()
    }
}
