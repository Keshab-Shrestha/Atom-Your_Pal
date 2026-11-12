//! The windows' views. `view` is Rune's view function: it reads the state and returns the element tree.

mod chat;
mod pages;
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
        Screen::Settings => ("Settings".to_owned(), pages::settings(app, k)),
        Screen::Agents => ("Agents".to_owned(), pages::agents(app, k)),
        Screen::Tasks => ("Tasks".to_owned(), pages::tasks(app, k)),
        Screen::Memory => ("Memory".to_owned(), pages::memory(app, k)),
        Screen::Dashboard => ("Dashboard".to_owned(), pages::dashboard(app, k)),
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

fn chord(item: rune::MenuItem<App>, keys: &str) -> rune::MenuItem<App> {
    match keys.parse() {
        Ok(shortcut) => item.key_equivalent(shortcut),
        Err(_) => item,
    }
}

/// The native menu: New Chat in File-like "Chat", the screens in "Go".
pub fn menu_items() -> Vec<rune::MenuItem<App>> {
    use rune::MenuItem;
    let go = |title: &str, screen: Screen, keys: &str| {
        let item = match screen {
            Screen::Agents => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Agents)),
            Screen::Tasks => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Tasks)),
            Screen::Memory => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Memory)),
            Screen::Dashboard => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Dashboard)),
            Screen::Settings => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Settings)),
            Screen::Chat => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Chat)),
        };
        chord(item.id(format!("go-{title}")).menu("Go"), keys)
    };
    vec![
        chord(MenuItem::new("New Chat", |s: &mut App, _| s.new_chat()).id("new-chat").menu("Chat"), "cmd+n"),
        go("Chat", Screen::Chat, "cmd+1"),
        go("Agents", Screen::Agents, "cmd+2"),
        go("Tasks", Screen::Tasks, "cmd+3"),
        go("Dashboard", Screen::Dashboard, "cmd+4"),
        go("Memory", Screen::Memory, "cmd+5"),
        go("Settings", Screen::Settings, "cmd+,"),
    ]
}
