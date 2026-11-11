//! AppKit glue for the checks Rune has no API for, through objc2. Every function runs on the
//! main thread (Rune's `on_ready` runs on winit's event thread, the main thread on macOS).

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, NSObject};
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSMenu, NSMenuItem, NSStatusBar, NSStatusItem, NSVariableStatusItemLength, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use rune::raw_window_handle::RawWindowHandle;

use crate::log::log;

const WEB_HTML: &str = "<html><body style='font:15px -apple-system;background:#fff;color:#111;margin:12px'>\
<h3>WKWebView child view</h3><p id='p'>Rune draws under this view.</p>\
<input id='i' placeholder='Type here (IME, dictation)' style='width:90%'>\
<button onclick=\"document.getElementById('p').textContent='Button clicked in WKWebView'\">Click me</button>\
</body></html>";

thread_local! {
    /// Native objects that must live as long as the app (status item, its menu target).
    static KEEP: RefCell<Vec<Retained<NSObject>>> = const { RefCell::new(Vec::new()) };
}

fn keep(obj: Retained<NSObject>) {
    KEEP.with(|k| k.borrow_mut().push(obj));
}

define_class!(
    /// The menu item target: logs each click.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ArkSpikeTarget"]
    struct SpikeTarget;

    impl SpikeTarget {
        #[unsafe(method(clicked:))]
        fn clicked(&self, sender: &NSMenuItem) {
            log(format!("status item menu click: {}", sender.title()));
        }
    }
);

impl SpikeTarget {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        // SAFETY: plain NSObject init on a freshly allocated object.
        unsafe { msg_send![Self::alloc(mtm), init] }
    }
}

/// Adds an "ARK spike" status item with a one-item menu whose action logs.
pub fn status_item() {
    let Some(mtm) = MainThreadMarker::new() else {
        log("status item: not on the main thread");
        return;
    };
    let bar = NSStatusBar::systemStatusBar();
    let item: Retained<NSStatusItem> = bar.statusItemWithLength(NSVariableStatusItemLength);
    if let Some(button) = item.button(mtm) {
        button.setTitle(&NSString::from_str("ARK spike"));
    }
    let target = SpikeTarget::new(mtm);
    let menu = NSMenu::new(mtm);
    // SAFETY: `clicked:` is defined on the target above with the matching signature.
    let entry = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(mtm.alloc(), &NSString::from_str("Spike click"), Some(sel!(clicked:)), &NSString::from_str(""))
    };
    // SAFETY: the target is kept alive in KEEP for the whole run.
    unsafe { entry.setTarget(Some(&target)) };
    menu.addItem(&entry);
    item.setMenu(Some(&menu));
    log(format!("status item added: visible={}", item.isVisible()));
    keep(target.into_super());
    keep(item.into_super());
}

/// winit's content view of a Rune window.
fn content_view(handle: &rune::WindowHandle) -> Option<Retained<NSView>> {
    let ptr = handle
        .with_raw_handle(|h| match h.as_raw() {
            RawWindowHandle::AppKit(a) => Some(a.ns_view),
            _ => None,
        })
        .ok()
        .flatten()?;
    // SAFETY: raw-window-handle's AppKit `ns_view` is a live NSView while the window lives.
    unsafe { Retained::retain(ptr.as_ptr().cast::<NSView>()) }
}

/// Orders a window in on the active Space of its display, as Rune's `App::overlay` panels do.
pub fn order_front(handle: &rune::WindowHandle) {
    let Some(window) = content_view(handle).and_then(|v| v.window()) else {
        log(format!("{}: no NSWindow", handle.key()));
        return;
    };
    window.orderFrontRegardless();
    log(format!("{}: orderFrontRegardless, on active space={}", handle.key(), window.isOnActiveSpace()));
}

/// A subview's layer composites over the content view's own sublayers, so the material would
/// hide Rune's `CAMetalLayer`. As Rune's own material host does (`system_material/macos.rs`),
/// lift the Metal layer to zPosition 1; lift the web view above it to 2.
fn raise_layers(view: &NSView, web: &NSView) {
    // SAFETY: CALayer reads and zPosition writes on the main thread, on layers the views own.
    unsafe {
        let root: *mut AnyObject = msg_send![view, layer];
        let Some(root) = root.as_ref() else { return log("raise layers: no root layer") };
        let layers: *mut AnyObject = msg_send![root, sublayers];
        let Some(layers) = layers.as_ref() else { return log("raise layers: no sublayers") };
        let count: usize = msg_send![layers, count];
        let metal_class = AnyClass::get(c"CAMetalLayer");
        let mut raised = 0;
        for i in 0..count {
            let layer: *mut AnyObject = msg_send![layers, objectAtIndex: i];
            if let (Some(layer), Some(class)) = (layer.as_ref(), metal_class) {
                let is_metal: bool = msg_send![layer, isKindOfClass: class];
                if is_metal {
                    let _: () = msg_send![layer, setZPosition: 1.0f64];
                    raised += 1;
                }
            }
        }
        let web_layer: *mut AnyObject = msg_send![web, layer];
        if let Some(web_layer) = web_layer.as_ref() {
            let _: () = msg_send![web_layer, setZPosition: 2.0f64];
        }
        log(format!("raise layers: {count} sublayers, {raised} CAMetalLayer lifted to z=1, web view z=2"));
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}

/// Puts a `.hudWindow` `NSVisualEffectView` under the whole Rune layer and a `WKWebView` over
/// the right half of the window.
pub fn add_native_views(handle: &rune::WindowHandle) {
    let (Some(mtm), Some(view)) = (MainThreadMarker::new(), content_view(handle)) else {
        log("native views: no main thread or no content view");
        return;
    };
    let b = view.bounds();
    let (w, h) = (b.size.width, b.size.height);

    let hud = NSVisualEffectView::initWithFrame(mtm.alloc(), b);
    hud.setMaterial(NSVisualEffectMaterial::HUDWindow);
    hud.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    hud.setState(NSVisualEffectState::Active);
    hud.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    // Below every other subview, as Rune's own material host is.
    view.addSubview_positioned_relativeTo(&hud, NSWindowOrderingMode::Below, None);
    log(format!("hud view added: material={:?} superview layer-backed={}", hud.material(), view.wantsLayer()));

    // SAFETY: plain allocation and init of WebKit objects on the main thread.
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    let (x, y, ww, wh) = (w / 2.0 + 8.0, 16.0, w / 2.0 - 24.0, h - 64.0);
    let frame = if view.isFlipped() { rect(x, 48.0, ww, wh) } else { rect(x, y, ww, wh) };
    // SAFETY: as above.
    let web = unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };
    // SAFETY: loads a constant HTML string with no base URL (no network).
    let _ = unsafe { web.loadHTMLString_baseURL(&NSString::from_str(WEB_HTML), None) };
    view.addSubview(&web);
    web.setWantsLayer(true);
    raise_layers(&view, &web);
    log(format!("web view added: frame=({x:.0}, {:.0}, {ww:.0}, {wh:.0}) flipped={}", frame.origin.y, view.isFlipped()));
}
