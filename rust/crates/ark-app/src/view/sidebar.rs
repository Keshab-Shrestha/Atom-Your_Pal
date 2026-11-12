//! The sidebar: new chat, the chat list and the screens.

use ark_protocol::Command;
use rune::El;
use rune_kit::Kit;
use rune_kit::shell::{RowStatus, Sidebar, SidebarRow};

use crate::app::{App, Screen};

pub fn view(app: &App, k: &Kit) -> El {
    let new_chat = SidebarRow::new("New chat")
        .height(32.0)
        .on_select(|s: &mut App, _| {
            s.screen = Screen::Chat;
            s.send(&Command::ChatNew { project_id: None });
        })
        .build(k)
        .key("new-chat");
    let mut sidebar = Sidebar::new().label("Chats").inset(0.0).header_gap(4.0).header_padding(0.0, 16.0).row_gap(4.0).header(new_chat);
    for chat in &app.model.chats {
        let id = chat.id.clone();
        let mut row = SidebarRow::new(chat.title.clone())
            .height(45.0)
            .subtitle(if chat.read_only { format!("{} messages · read only", chat.messages) } else { format!("{} messages", chat.messages) })
            .selected(app.model.current.as_deref() == Some(chat.id.as_str()) && app.screen == Screen::Chat)
            .on_select({
                let id = id.clone();
                move |s: &mut App, _| {
                    s.screen = Screen::Chat;
                    s.send(&Command::ChatOpen { id: id.clone() });
                }
            });
        if app.model.current.as_deref() == Some(chat.id.as_str()) && app.model.busy() {
            row = row.status(RowStatus::Busy);
        }
        sidebar = sidebar.child(row.build(k).key(format!("chat-{id}")));
    }
    for (screen, label) in [(Screen::Agents, "Agents"), (Screen::Tasks, "Tasks"), (Screen::Dashboard, "Dashboard"), (Screen::Memory, "Memory"), (Screen::Projects, "Projects"), (Screen::Branches, "Branches"), (Screen::Settings, "Settings")] {
        let row = SidebarRow::new(label).height(32.0).selected(app.screen == screen).on_select(move |s: &mut App, _| s.goto(screen));
        sidebar = sidebar.footer(row.build(k).key(format!("nav-{}", label.to_lowercase())));
    }
    sidebar.build(k)
}
