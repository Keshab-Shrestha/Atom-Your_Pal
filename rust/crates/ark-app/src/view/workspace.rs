//! The workspace page (WorkspaceBrowserView.swift, WorkspaceTerminalView.swift): a browser address bar and a terminal.
//! Rune has no web view, so the address opens in the default browser. The terminal runs one command at a time.

use rune::{El, row, text, col};
use rune_kit::{Button, ButtonVariant, Kit, TextArea};

use super::pages::{card, page};
use crate::app::App;

pub fn workspace(app: &App, k: &Kit) -> El {
    let mut cards = Vec::new();
    let mut projects = row().gap(8.0).wrap();
    for p in app.model.projects.iter().filter(|p| !p.archived && !p.missing) {
        let id = p.id.clone();
        let on = app.workspace_project.as_deref() == Some(p.id.as_str());
        projects = projects.child(Button::new(p.name.clone()).variant(if on { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(move |s: &mut App| s.workspace(&id, "list", "")).build(k).key(format!("ws-project-{}", p.id)));
    }
    let root = app.model.workspace.as_ref().and_then(|w| w.root.clone());
    cards.push(card(k, "ws-project", "Project").child(projects).child(text(root.clone().unwrap_or_else(|| "Choose a project. Its folder is where commands run.".into())).key("ws-root").font(k.ty.small).color(k.c.text_muted).wrap()));
    let address = TextArea::new(&app.more.address).placeholder("Address (https://...)").label("Address").auto_grow(1, 1).on_edit(|s: &mut App| &mut s.more.address).on_submit(|s: &mut App, _| s.open_address()).build(k).key("ws-address").w_full();
    cards.push(card(k, "ws-browser", "Browser").child(address).child(row().justify_end().child(Button::new("Open").variant(ButtonVariant::Submit).on_press(|s: &mut App| s.open_address()).build(k).key("ws-open"))));
    let (lines, running, code, _) = app.more.terminal.snapshot();
    let command = TextArea::new(&app.more.command).placeholder("Command").label("Command").auto_grow(1, 3).on_edit(|s: &mut App| &mut s.more.command).on_submit(|s: &mut App, _| s.run_command_line()).build(k).key("ws-command").w_full();
    let mut out = col().key("ws-output").w_full().gap(2.0);
    for (i, line) in lines.iter().rev().take(200).rev().enumerate() {
        out = out.child(text(line.clone()).key(format!("ws-line-{i}")).font(k.ty.mono).color(k.c.text_base).wrap());
    }
    let status = match (running, code) {
        (true, _) => "Running…".to_owned(),
        (false, Some(0)) => "Done.".to_owned(),
        (false, Some(c)) => format!("Ended with code {c}."),
        (false, None) => String::new(),
    };
    let mut term = card(k, "ws-terminal", "Terminal").child(command).child(
        row()
            .gap(8.0)
            .justify_end()
            .child(Button::new("Clear").on_press(|s: &mut App| s.more.terminal.clear()).build(k).key("ws-clear"))
            .child(Button::new("Stop").disabled(!running).on_press(|s: &mut App| s.more.terminal.stop()).build(k).key("ws-stop"))
            .child(Button::new("Run").variant(ButtonVariant::Submit).disabled(root.is_none()).on_press(|s: &mut App| s.run_command_line()).build(k).key("ws-run")),
    );
    if let Some(note) = &app.more.terminal_note {
        term = term.child(text(note.clone()).key("ws-note").font(k.ty.small).color(k.c.text_muted).wrap());
    }
    cards.push(term.child(out).child(text(status).key("ws-status").font(k.ty.small).color(k.c.text_muted)));
    page(k, "workspace", "Workspace", cards)
}
