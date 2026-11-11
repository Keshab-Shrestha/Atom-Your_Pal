//! Check group B (windows): an `NSStatusItem` next to a Rune window, hover in an interactive
//! (non-key) `App::overlay` panel, and one `WindowOptions::overlay(display)` window per display.
//! Each display also gets a small ordinary "target" window, so a click-through test only ever
//! clicks this app's own windows.

use rune::tok::{self, type_};
use rune::{Align, App, AppSpec, Cx, DisplayTarget, El, MacWindowOptions, OverlayHandle, OverlayOptions, OverlayPlacement, OverlaySpec, ScreenEdge, Tx, WindowOptions, WindowSpec, col, row, text};

use crate::log::{self, log};

/// Points from an overlay window's top-left to its marked box (`--catch` clicks there).
pub const OVERLAY_BOX: (f32, f32, f32, f32) = (80.0, 80.0, 360.0, 120.0);
/// Physical pixels from a display's origin to its target window.
const TARGET_OFFSET: i32 = 300;
/// AppKit collection behaviour for `--all-spaces`: canJoinAllSpaces | stationary | fullScreenAuxiliary.
const ALL_SPACES: usize = 1 | 1 << 4 | 1 << 8;
/// `NSStatusWindowLevel`, the level of Rune's `App::overlay` panels.
const STATUS_LEVEL: isize = 25;

struct Main {
    _panel: OverlayHandle<Hover>,
    _others: Vec<OverlayHandle<Hover>>,
    seen: u64,
}

#[derive(Default)]
struct Hover {
    name: String,
    over: bool,
}

fn hover_box(s: &Hover, label: &str) -> El {
    let t = tok::theme(true);
    let fill = if s.over { t.press } else { t.card };
    let (enter, press) = (format!("{} hover", s.name), format!("{} press", s.name));
    col().key("box").padding(12.0).radius(8.0).fill(fill).border(1.0, t.text)
        .child(text(label.to_owned()).color(t.text))
        .on_hover_change(move |s: &mut Hover, over, _: &mut Tx| {
            s.over = over;
            log(format!("{enter}: {over}"));
        })
        .on_press(move |_: &mut Hover| log(press.clone()))
}

fn main_view(_: &Main, _: &mut Cx<Main>) -> El {
    let t = tok::theme(true);
    col().w_full().h_full().gap(8.0).padding(16.0).fill(t.bg)
        .child(text("ARK spike: windows").font(type_::TITLE).color(t.text))
        .child(text("Menu bar: \"ARK spike\" item. Top of the main display: the panel.").color(t.text_secondary))
        .child(text("Each display: a full-display overlay with a box, and a target window.").color(t.text_secondary))
        .child(log::view(16, t.text))
}

fn main_poll(s: &mut Main, _: f64, _: &mut Tx) -> bool {
    let changed = log::count() != s.seen;
    s.seen = log::count();
    changed
}

fn panel_view(s: &Hover, _: &mut Cx<Hover>) -> El {
    col().w_full().h_full().child(hover_box(s, "Panel: hover or click me"))
}

fn overlay_view(s: &Hover, _: &mut Cx<Hover>) -> El {
    let (x, y, w, h) = OVERLAY_BOX;
    // No fill on the root: the rest of the display stays clear.
    col().w_full().h_full()
        .child(col().h(y))
        .child(row().child(col().w(x)).child(hover_box(s, &format!("{}: full-display overlay box", s.name)).w(w).h(h)))
}

fn target_view(s: &Hover, _: &mut Cx<Hover>) -> El {
    let t = tok::theme(true);
    col().w_full().h_full().padding(16.0).fill(t.bg).child(hover_box(s, &format!("{}: click me", s.name)).w_full().h_full())
}

fn default_main() -> Main {
    unreachable!("App::init builds the main state")
}

pub fn run(catch: bool, all_spaces: bool) {
    log(format!("windows check: overlays {}, all spaces: {all_spaces}", if catch { "take clicks (--catch)" } else { "are click-through" }));
    rune::run_windows(move |displays| {
        let spec = AppSpec { setup: Some(|_, w| log::set_waker(w)), poll: Some(main_poll), ..AppSpec::new("ARK spike: windows", (520.0, 460.0), default_main, main_view) };
        let mut app = App::new(spec).on_ready(|h| {
            log(format!("main window number: {:?}", h.window_number()));
            #[cfg(target_os = "macos")]
            crate::mac::status_item();
        });
        let panel = app.overlay(
            OverlaySpec { name: "ark-spike-panel", size: (280.0, 90.0), edge: ScreenEdge::Top, margin: 160.0, align: Align::Center, inset: 0.0, interactive: true, view: panel_view },
            Hover { name: "panel".into(), over: false },
        );
        panel.show();
        // The same panel API on every other display (the README says "primary display only").
        let mut others = Vec::new();
        for (i, d) in displays.iter().enumerate().filter(|(_, d)| !d.primary) {
            let Some(id) = d.id.clone() else { continue };
            let spec = OverlaySpec { name: "ark-spike-panel-other", size: (280.0, 90.0), edge: ScreenEdge::Top, margin: 0.0, align: Align::Start, inset: 0.0, interactive: true, view: panel_view };
            let options = OverlayOptions { display: DisplayTarget::Id(id), placement: Some(OverlayPlacement::Rect { x: 80.0, y: 240.0, width: 280.0, height: 90.0 }), ..OverlayOptions::default() };
            let handle = app.overlay(spec.options(options), Hover { name: format!("panel on display {i}"), over: false });
            handle.show();
            others.push(handle);
        }
        let app = app.init(move || Main { _panel: panel, _others: others, seen: 0 });

        let mut specs = vec![WindowSpec::from_app("main", app).boxed()];
        for (i, d) in displays.iter().enumerate() {
            let name = format!("display {i}{}", if d.primary { " (main)" } else { "" });
            log(format!("{name}: position {:?} size {:?} scale {}", d.position, d.size, d.scale));
            let overlay_name = format!("overlay {i}");
            specs.push(WindowSpec::new(format!("overlay-{i}"), AppSpec::new("ark-spike-overlay", (100.0, 100.0), Hover::default, overlay_view))
                .state(Hover { name: overlay_name.clone(), over: false })
                .configured_options(if all_spaces {
                    WindowOptions::overlay(d).macos(MacWindowOptions::default().collection_behavior(ALL_SPACES).level(STATUS_LEVEL))
                } else {
                    WindowOptions::overlay(d).macos(MacWindowOptions::default())
                })
                .on_created(move |h| {
                    if catch && let Err(e) = h.set_click_through(false) {
                        log(format!("{overlay_name}: set_click_through(false) failed: {e}"));
                    }
                    log(format!("{overlay_name} window number: {:?}", h.window_number()));
                    #[cfg(target_os = "macos")]
                    if all_spaces {
                        crate::mac::order_front(&h);
                    }
                })
                .boxed());
            let target_name = format!("target {i}");
            let position = (d.position.0 + TARGET_OFFSET, d.position.1 + TARGET_OFFSET);
            specs.push(WindowSpec::new(format!("target-{i}"), AppSpec::new("ark-spike-target", (300.0, 160.0), Hover::default, target_view))
                .state(Hover { name: target_name.clone(), over: false })
                .options(WindowOptions { position: Some(position), ..WindowOptions::default() })
                .on_created(move |h| log(format!("{target_name} window number: {:?}", h.window_number())))
                .boxed());
        }
        specs
    });
}
