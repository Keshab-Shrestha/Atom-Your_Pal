//! The windows' views. `view` is Rune's view function: it reads the state and returns the element tree.

mod chat;
mod sidebar;

use rune::{Chrome, Cx, El};
use rune_kit::shell::{self, PaneMotion, SidebarToggle, SplitView, Toolbar};
use rune_kit::{ControlSize, Kit};

use crate::app::{App, Screen};

fn pick_kit(dark: bool) -> &'static Kit {
    rune_theme_opencode::kit(dark)
}

/// The traffic lights sit centred on the toolbar, as in rune-kit's shell example.
pub const CHROME: Chrome = Chrome { full_size_content: true, traffic_lights: Some((16.0, 25.0)), drag_regions: true };

fn status_line(app: &App) -> String {
    use ark_ui::Conn;
    match &app.model.conn {
        Conn::Starting => "Starting…".into(),
        Conn::Down(why) => why.clone(),
        Conn::Ready if app.model.busy() => "Thinking…".into(),
        Conn::Ready => format!("{} · {}", app.model.provider, app.model.model),
    }
}

pub fn view(app: &App, cx: &mut Cx<App>) -> El {
    let k = pick_kit(cx.system_dark());
    let (title, main) = match app.screen {
        Screen::Chat => (app.model.current_title().to_owned(), chat::view(app, k)),
        other => (format!("{other:?}"), chat::view(app, k)),
    };
    let toolbar = Toolbar::new().title(title).trailing(chat::status(app, k, &status_line(app)));
    SplitView::new(main)
        .sidebar(&app.sidebar, |s: &mut App| &mut s.sidebar, sidebar::view(app, k))
        .toolbar(toolbar)
        .titlebar_inset(cx.titlebar_inset())
        .frame_inset(8.0)
        .toolbar_in_panel()
        .sidebar_padding(18.0, 10.0)
        .sidebar_toggle(SidebarToggle::new().size(ControlSize::Large).past_lights(16.0).edge(18.0).gap(4.0).in_header())
        .pane_motion(PaneMotion::new())
        .reduced_motion(cx.is_reduced_motion())
        .build(k)
}

pub fn on_key(app: &mut App, ev: &rune::KeyEvent, _: &mut rune::Tx) -> bool {
    if shell::is_sidebar_toggle(ev) {
        app.sidebar.toggle();
        return true;
    }
    false
}
