//! The windows' views. `view` is Rune's view function: it reads the state and returns the element tree.

mod automations;
mod chat;
mod diff;
mod form;
mod palette;
mod plugins;
mod pages;
mod sidebar;
mod tools;
mod visual;

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
    let dark = match app.prefs.theme {
        crate::prefs::Theme::System => cx.system_dark(),
        crate::prefs::Theme::Light => false,
        crate::prefs::Theme::Dark => true,
    };
    let k = pick_kit(dark);
    let (title, main) = match app.screen {
        _ if app.palette.is_some() => ("Command palette".to_owned(), app.palette.as_ref().map_or_else(rune::col, |q| palette::view(app, q, k))),
        _ if app.form.is_some() => ("Edit".to_owned(), app.form.as_ref().map_or_else(rune::col, |f| form::view(app, f, k))),
        Screen::Chat => (app.model.current_title().to_owned(), chat::view(app, k)),
        Screen::Settings => ("Settings".to_owned(), pages::settings(app, k)),
        Screen::Agents => ("Agents".to_owned(), pages::agents(app, k)),
        Screen::Tasks => ("Tasks".to_owned(), pages::tasks(app, k)),
        Screen::Memory => ("Memory".to_owned(), pages::memory(app, k)),
        Screen::Projects => ("Projects".to_owned(), pages::projects(app, k)),
        Screen::Branches => ("Branches".to_owned(), pages::branches(app, k)),
        Screen::Search => ("Search".to_owned(), pages::search(app, k)),
        Screen::Dashboard => ("Dashboard".to_owned(), pages::dashboard(app, k)),
        Screen::Workflows => ("Automations".to_owned(), automations::workflows(app, k)),
        Screen::Plugins => ("Plugins".to_owned(), plugins::plugins(app, k)),
        Screen::Skills => ("Skills hub".to_owned(), plugins::skills(app, k)),
        Screen::Backup => ("Local backup".to_owned(), tools::backup(app, k)),
        Screen::Replies => ("Reply drafts".to_owned(), tools::replies(app, k)),
        Screen::Plans => ("Plans".to_owned(), tools::plans(app, k)),
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

pub fn on_key(app: &mut App, ev: &rune::KeyEvent, tx: &mut rune::Tx) -> bool {
    if ev.key == rune::Key::Escape && app.escape() {
        return true;
    }
    if ev.mods.cmd && !ev.mods.shift && !ev.mods.alt {
        if ev.is_command('w') {
            tx.close_window();
            return true;
        }
        if ev.is_command('q') {
            tx.quit();
            return true;
        }
    }
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
            Screen::Search => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Search)),
            Screen::Branches => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Branches)),
            Screen::Projects => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Projects)),
            Screen::Memory => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Memory)),
            Screen::Dashboard => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Dashboard)),
            Screen::Settings => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Settings)),
            Screen::Chat => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Chat)),
            Screen::Workflows => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Workflows)),
            Screen::Plugins => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Plugins)),
            Screen::Skills => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Skills)),
            Screen::Backup => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Backup)),
            Screen::Replies => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Replies)),
            Screen::Plans => MenuItem::new(title, |s: &mut App, _| s.goto(Screen::Plans)),
        };
        chord(item.id(format!("go-{title}")).menu("Go"), keys)
    };
    vec![
        chord(MenuItem::new("New Chat", |s: &mut App, _| s.new_chat()).id("new-chat").menu("Chat"), "cmd+n"),
        chord(MenuItem::new("Command Palette", |s: &mut App, _| s.toggle_palette()).id("command-palette").menu("Chat"), "cmd+k"),
        chord(MenuItem::new("Find in Chat", |s: &mut App, _| s.toggle_find()).id("find-in-chat").menu("Chat"), "cmd+f"),
        go("Chat", Screen::Chat, "cmd+1"),
        go("Agents", Screen::Agents, "cmd+2"),
        go("Tasks", Screen::Tasks, "cmd+3"),
        go("Dashboard", Screen::Dashboard, "cmd+4"),
        go("Memory", Screen::Memory, "cmd+5"),
        go("Projects", Screen::Projects, "cmd+6"),
        go("Branches", Screen::Branches, "cmd+7"),
        go("Search", Screen::Search, "cmd+shift+f"),
        go("Automations", Screen::Workflows, "cmd+8"),
        go("Plugins", Screen::Plugins, "cmd+9"),
        go("Skills hub", Screen::Skills, "cmd+0"),
        go("Plans", Screen::Plans, "cmd+shift+p"),
        go("Reply drafts", Screen::Replies, "cmd+shift+r"),
        go("Local backup", Screen::Backup, "cmd+shift+b"),
        go("Settings", Screen::Settings, "cmd+,"),
    ]
}
