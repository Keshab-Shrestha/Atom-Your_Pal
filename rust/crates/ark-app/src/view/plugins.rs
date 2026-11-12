//! The Plugins page (PluginsView.swift: MCP servers, skill drafts, skill edits) and the Skills hub (HubSkillsView.swift).

use ark_protocol::Command;
use rune::{El, row, text};
use rune_kit::{Button, ButtonVariant, Kit, TextArea};

use super::pages::{card, page, waiting};
use crate::app::App;
use crate::form::Form;

fn small(k: &Kit, key: String, words: String) -> El {
    text(words).key(key).font(k.ty.small).color(k.c.text_muted).wrap()
}

fn btn(k: &Kit, key: String, label: &str, on: bool, f: impl Fn(&mut App) + Send + Sync + 'static) -> El {
    Button::new(label).variant(if on { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(f).build(k).key(key)
}

pub fn plugins(app: &App, k: &Kit) -> El {
    let x = &app.model.extras;
    let mut cards = vec![
        text("Plugin servers (MCP) give agents more tools. Each one stays off until you turn it on. Mark it trusted to skip its prompts.").key("plug-intro").font(k.ty.ui).color(k.c.text_muted).wrap(),
        row().child(Button::new("Add server").variant(ButtonVariant::Submit).on_press(|s: &mut App| s.open_form(Form::mcp())).build(k).key("plug-add")),
    ];
    if app.model.helpers.is_none() {
        cards.push(waiting(app, "plug-loading", "plugins", k));
    } else if x.mcp.is_empty() {
        cards.push(card(k, "plug-empty", "No plugin servers").child(text("Add one with Add server.").font(k.ty.ui).color(k.c.text_faint)));
    }
    for m in &x.mcp {
        let (id, armed) = (m.id, app.more.confirm.as_deref() == Some(format!("mcp-{}", m.id).as_str()));
        let (enabled, trusted) = (m.enabled, m.trusted);
        let tools = if m.tools.is_empty() { "No tools listed yet. Choose Test.".to_owned() } else { format!("Tools: {}", m.tools.join(", ")) };
        let mut c = card(k, &format!("mcp-{id}"), &m.name).child(small(k, format!("mcp-target-{id}"), m.target.clone())).child(small(k, format!("mcp-tools-{id}"), tools));
        if let Some(problem) = &m.problem {
            c = c.child(text(problem.clone()).key(format!("mcp-problem-{id}")).font(k.ty.small).color(k.c.danger.fg).wrap());
        }
        cards.push(c.child(
            row()
                .gap(8.0)
                .wrap()
                .child(btn(k, format!("mcp-on-{id}"), if enabled { "On" } else { "Off" }, enabled, move |s| s.send(&Command::McpSet { id, enabled: Some(!enabled), trusted: None, workers: None })))
                .child(btn(k, format!("mcp-trust-{id}"), if trusted { "Trusted" } else { "Not trusted" }, trusted, move |s| s.send(&Command::McpSet { id, enabled: None, trusted: Some(!trusted), workers: None })))
                .child(btn(k, format!("mcp-test-{id}"), "Test", false, move |s| s.send(&Command::McpTest { id })))
                .child(btn(k, format!("mcp-remove-{id}"), if armed { "Confirm remove" } else { "Remove" }, armed, move |s| s.confirm_or(&format!("mcp-{id}"), move |s| s.send(&Command::McpRemove { id })))),
        ));
    }
    for d in x.skill_drafts.iter().filter(|d| d.state == "pending") {
        let id = d.id;
        cards.push(
            card(k, &format!("draft-{id}"), &format!("Skill draft: {}", d.name))
                .child(small(k, format!("draft-by-{id}"), format!("{} · {}", d.helper, d.description)))
                .child(text(d.preview.clone()).key(format!("draft-preview-{id}")).font(k.ty.ui).color(k.c.text_base).wrap())
                .child(row().gap(8.0).justify_end().child(btn(k, format!("draft-reject-{id}"), "Reject", false, move |s| s.send(&Command::SkillReject { id }))).child(btn(k, format!("draft-approve-{id}"), "Approve", true, move |s| s.send(&Command::SkillApprove { id })))),
        );
    }
    for e in x.skill_edits.iter().filter(|e| matches!(e.state.as_str(), "pending" | "accepted")) {
        let (id, pending) = (e.id, e.state == "pending");
        let buttons = if pending {
            row().gap(8.0).justify_end().child(btn(k, format!("edit-reject-{id}"), "Reject", false, move |s| s.send(&Command::SkillEditReject { id }))).child(btn(k, format!("edit-accept-{id}"), "Accept", true, move |s| s.send(&Command::SkillEditAccept { id })))
        } else {
            row().gap(8.0).justify_end().child(btn(k, format!("edit-undo-{id}"), "Undo", false, move |s| s.send(&Command::SkillEditUndo { id })))
        };
        cards.push(
            card(k, &format!("edit-{id}"), &format!("Change to skill {}", e.skill))
                .child(small(k, format!("edit-why-{id}"), e.reason.clone()))
                .child(text(format!("Before: {}", e.before)).key(format!("edit-before-{id}")).font(k.ty.ui).color(k.c.text_muted).wrap())
                .child(text(format!("After: {}", e.after)).key(format!("edit-after-{id}")).font(k.ty.ui).color(k.c.text_base).wrap())
                .child(buttons),
        );
    }
    page(k, "plugins", "Plugins", cards)
}

pub fn skills(app: &App, k: &Kit) -> El {
    let search = TextArea::new(&app.more.hub_query)
        .placeholder("Search community skills")
        .label("Search community skills")
        .auto_grow(1, 1)
        .on_edit(|s: &mut App| &mut s.more.hub_query)
        .on_submit(|s: &mut App, _| s.search_hub())
        .build(k)
        .key("hub-search")
        .w_full();
    let mut cards = vec![
        text("Find community skills, read them, then approve. Nothing goes to an agent when you install it.").key("hub-intro").font(k.ty.ui).color(k.c.text_muted).wrap(),
        search,
        row().justify_end().child(btn(k, "hub-go".into(), "Search", true, |s| s.search_hub())),
    ];
    if app.model.helpers.is_none() {
        cards.push(waiting(app, "hub-loading", "the skills hub", k));
        return page(k, "skills", "Skills hub", cards);
    }
    let empty = ark_ui::extras::Hub::default();
    let hub = app.model.extras.hub.as_ref().unwrap_or(&empty);
    if let Some(message) = &hub.message {
        cards.push(text(message.clone()).key("hub-message").font(k.ty.small).color(k.c.text_muted).wrap());
    }
    for (i, p) in hub.pending.iter().enumerate() {
        let id = p.id;
        let mut c = card(k, &format!("hub-pending-{id}"), &format!("{}: {}", if p.update { "Update" } else { "New skill" }, p.name)).child(small(k, format!("hub-pending-from-{i}"), format!("{} · {}", p.repo, p.description)));
        for (j, (severity, kind, excerpt)) in p.flags.iter().enumerate() {
            c = c.child(text(format!("{}: {kind} · {excerpt}", if severity == "warn" { "Warning" } else { "Note" })).key(format!("hub-flag-{id}-{j}")).font(k.ty.small).color(if severity == "warn" { k.c.danger.fg } else { k.c.text_muted }).wrap());
        }
        cards.push(
            c.child(text(p.text.clone()).key(format!("hub-text-{id}")).font(k.ty.ui).color(k.c.text_base).wrap())
                .child(row().gap(8.0).justify_end().child(btn(k, format!("hub-reject-{id}"), "Reject", false, move |s| s.send(&Command::SkillHubReject { id }))).child(btn(k, format!("hub-approve-{id}"), "Approve and install", true, move |s| s.send(&Command::SkillHubApprove { id })))),
        );
    }
    for (i, r) in hub.results.iter().enumerate() {
        let (source, path) = (r.source, r.path.clone());
        let sha: String = r.sha.chars().take(7).collect();
        cards.push(
            card(k, &format!("hub-result-{i}"), &r.name)
                .child(small(k, format!("hub-result-info-{i}"), format!("{} · {sha}", r.repo)))
                .child(text(r.description.clone()).key(format!("hub-result-text-{i}")).font(k.ty.ui).color(k.c.text_base).wrap())
                .child(row().justify_end().child(btn(k, format!("hub-preview-{i}"), "Read it", false, move |s| s.send(&Command::SkillHubPreview { source, path: path.clone() })))),
        );
    }
    if !hub.installed.is_empty() {
        let mut c = card(k, "hub-installed", "Installed");
        for (i, (name, repo)) in hub.installed.iter().enumerate() {
            let (update, remove) = (name.clone(), name.clone());
            c = c.child(row().w_full().gap(8.0).items_center().child(text(format!("{name} · {repo}")).key(format!("hub-installed-{i}")).font(k.ty.ui).color(k.c.text_base)).child(btn(k, format!("hub-update-{i}"), "Update", false, move |s| s.send(&Command::SkillHubUpdate { name: update.clone() }))).child(btn(k, format!("hub-uninstall-{i}"), "Uninstall", false, move |s| s.send(&Command::SkillHubUninstall { name: remove.clone(), force: None }))));
        }
        cards.push(c);
    }
    page(k, "skills", "Skills hub", cards)
}
