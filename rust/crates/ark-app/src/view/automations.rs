//! The Automations page (WorkflowsPane.swift): workflows, and the routines of the agents drawn as one-step automations.

use ark_protocol::Command;
use ark_ui::extras::Workflow;
use rune::{El, row, text};
use rune_kit::{Button, ButtonVariant, Kit};

use super::pages::{card, page, waiting};
use crate::app::App;
use crate::form::Form;

const FILTERS: [&str; 4] = ["All", "On a timer", "When something happens", "By hand"];

fn shown(filter: usize, kind: &str) -> bool {
    matches!((filter, kind), (0, _) | (1, "schedule") | (2, "event") | (3, "manual"))
}

fn flow_card(app: &App, w: &Workflow, k: &Kit) -> El {
    let id = w.id.clone();
    let mut c = card(k, &format!("flow-{}", w.id), &w.name).child(text(format!("{} · {}", w.trigger, if w.enabled { "On" } else { "Off" })).font(k.ty.small).color(k.c.text_muted));
    for (i, (helper, task)) in w.steps.iter().enumerate() {
        c = c.child(text(format!("{}. {helper}: {task}", i + 1)).font(k.ty.ui).color(k.c.text_base).wrap());
    }
    if let Some(last) = &w.last_run {
        c = c.child(text(format!("Last run {last}")).font(k.ty.small).color(k.c.text_faint));
    }
    let armed = app.more.confirm.as_deref() == Some(w.id.as_str());
    let (run, toggle, del) = (id.clone(), id.clone(), id.clone());
    c.child(
        row()
            .gap(8.0)
            .justify_end()
            .child(Button::new("Run").on_press(move |s: &mut App| s.send(&Command::WorkflowRun { id: run.clone() })).build(k).key(format!("flow-run-{id}")))
            .child(Button::new(if w.enabled { "Turn off" } else { "Turn on" }).on_press(move |s: &mut App| s.toggle_workflow(&toggle)).build(k).key(format!("flow-toggle-{id}")))
            .child(
                Button::new(if armed { "Confirm delete" } else { "Delete" })
                    .variant(if armed { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                    .on_press(move |s: &mut App| {
                        let id = del.clone();
                        s.confirm_or(&id.clone(), move |s| {
                            s.send(&Command::WorkflowDelete { id });
                            s.send(&Command::WorkflowsList);
                        });
                    })
                    .build(k)
                    .key(format!("flow-delete-{id}")),
            ),
    )
}

pub fn workflows(app: &App, k: &Kit) -> El {
    let filter = app.more.flow_filter;
    let mut cards = vec![text("What runs by itself: a trigger, then steps your agents run in order. Each step gets the report of the one before.").key("flow-intro").font(k.ty.ui).color(k.c.text_muted).wrap()];
    let mut bar = row().gap(8.0).wrap().child(Button::new("New automation").variant(ButtonVariant::Submit).on_press(|s: &mut App| s.open_form(Form::workflow())).build(k).key("flow-new"));
    for (i, label) in FILTERS.iter().enumerate() {
        bar = bar.child(Button::new(*label).variant(if i == filter { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(move |s: &mut App| s.more.flow_filter = i).build(k).key(format!("flow-filter-{i}")));
    }
    cards.push(bar);
    if let Some(problem) = &app.model.extras.workflow_problem {
        cards.push(text(problem.clone()).key("flow-problem").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    let (Some(list), Some(helpers)) = (&app.model.extras.workflows, &app.model.helpers) else {
        cards.push(waiting(app, "flow-loading", "automations", k));
        return page(k, "workflows", "Automations", cards);
    };
    let flows: Vec<&Workflow> = list.iter().filter(|w| shown(filter, &w.trigger_kind)).collect();
    let routines: Vec<_> = if matches!(filter, 0 | 1) { helpers.iter().flat_map(|h| h.routines.iter().map(move |r| (h, r))).collect() } else { Vec::new() };
    if flows.is_empty() && routines.is_empty() {
        cards.push(card(k, "flow-empty", "No automations here").child(text("Make one: for example, every morning Sid collects the news, then Quill writes a short summary.").font(k.ty.ui).color(k.c.text_faint).wrap()));
    }
    cards.extend(flows.into_iter().map(|w| flow_card(app, w, k)));
    for (h, r) in routines {
        let (id, paused) = (r.id, r.paused);
        let armed = app.more.confirm.as_deref() == Some(format!("routine-{id}").as_str());
        cards.push(
            card(k, &format!("routine-{id}"), &r.task)
                .child(text(format!("{} · {}{}", h.name, r.when, if paused { " · paused" } else { "" })).font(k.ty.small).color(k.c.text_muted))
                .child(
                    row()
                        .gap(8.0)
                        .justify_end()
                        .child(Button::new(if paused { "Resume" } else { "Pause" }).on_press(move |s: &mut App| { s.send(&Command::RoutinePause { id, paused: !paused }); s.send(&Command::HelpersList); }).build(k).key(format!("routine-pause-{id}")))
                        .child(
                            Button::new(if armed { "Confirm delete" } else { "Delete" })
                                .variant(if armed { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                                .on_press(move |s: &mut App| s.confirm_or(&format!("routine-{id}"), move |s| { s.send(&Command::RoutineDelete { id }); s.send(&Command::HelpersList); }))
                                .build(k)
                                .key(format!("routine-delete-{id}")),
                        ),
                ),
        );
    }
    page(k, "workflows", "Automations", cards)
}
