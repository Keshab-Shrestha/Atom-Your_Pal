//! Check group C (native views): an `NSVisualEffectView` with the `.hudWindow` material behind a
//! transparent Rune window, and a `WKWebView` child view over Rune's Metal layer. A striped,
//! opaque "backdrop" window sits behind at the same place, so the blur shows this app's own
//! pattern and a window capture never holds another app's content.

use rune::tok::{self, type_};
use rune::{AppSpec, Cx, El, Tx, WindowOptions, WindowSpec, col, oklch, row, text};

use crate::log::{self, log};

pub const SIZE: (f32, f32) = (640.0, 400.0);
/// Physical pixels from the main display's origin.
const POSITION: (i32, i32) = (160, 160);
const STRIPES: usize = 16;

struct Views {
    seen: u64,
}

fn views_view(_: &Views, _: &mut Cx<Views>) -> El {
    let t = tok::theme(true);
    // No fill on the root: the window is transparent, so the native material shows through.
    col().w_full().h_full().gap(8.0).padding(16.0).window_drag()
        .child(text("ARK spike: views").font(type_::TITLE).color(t.text))
        .child(row().w_full().grow(1.0).gap(16.0)
            .child(col().grow(1.0).gap(6.0)
                .child(text("Left: .hudWindow material (blur of the stripes)").color(t.text))
                .child(text("Right: WKWebView child view").color(t.text))
                .child(log::view(8, t.text)))
            .child(col().grow(1.0)))
}

fn views_poll(s: &mut Views, _: f64, _: &mut Tx) -> bool {
    let changed = log::count() != s.seen;
    s.seen = log::count();
    changed
}

fn backdrop_view(_: &(), _: &mut Cx<()>) -> El {
    let mut stripes = row().w_full().h_full();
    for i in 0..STRIPES {
        let c = if i % 2 == 0 { oklch(0.7, 0.18, 45.0) } else { oklch(0.55, 0.18, 260.0) };
        stripes = stripes.child(col().grow(1.0).h_full().fill(c));
    }
    stripes
}

pub fn run() {
    rune::run_windows(|_| {
        let options = WindowOptions { position: Some(POSITION), borderless: true, resizable: false, ..WindowOptions::default() };
        let backdrop = WindowSpec::new("backdrop", AppSpec::new("ark-spike-backdrop", SIZE, || (), backdrop_view))
            .options(options.clone())
            .on_created(|h| log(format!("backdrop window number: {:?}", h.window_number())));
        let spec = AppSpec { setup: Some(|_, w| log::set_waker(w)), poll: Some(views_poll), ..AppSpec::new("ARK spike: views", SIZE, || Views { seen: 0 }, views_view) };
        let views = WindowSpec::new("views", spec)
            .options(WindowOptions { transparent: true, ..options })
            .on_ready(|h| {
                log(format!("views window number: {:?}", h.window_number()));
                #[cfg(target_os = "macos")]
                crate::mac::add_native_views(h);
            });
        vec![backdrop.boxed(), views.boxed()]
    });
}
