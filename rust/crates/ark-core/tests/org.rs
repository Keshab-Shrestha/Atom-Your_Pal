//! The pure cases of apps/mac/src/org.test.ts and apps/mac/island/Tests/ArkIslandCoreTests/OrgChartTests.swift, one
//! for one. The org.json store tests read the disk and move with the store in Phase 2.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_core::org::*;

fn map(pairs: &[(&str, &str)]) -> ReportsTo {
    pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn names(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |id| pairs.iter().find(|(k, _)| *k == id).map(|(_, v)| v.to_string())
}

const TEAM: &[&str] = &["kame", "lyra", "pk", "sid", "quill"];

#[test]
fn org_agent_ids_leaves_the_improver_out() {
    assert_eq!(org_agent_ids(&[Member { id: "sid", role: "researcher" }, Member { id: "tinker", role: "improver" }]), ["sid"]);
}

#[test]
fn check_reports_to_refuses_unknown_agents_self_leads_loops_and_too_many_levels() {
    let team = ids(TEAM);
    let err = |agent: &str, lead: &str, current: &ReportsTo| check_reports_to(agent, Some(lead), current, &team).unwrap_err();
    assert!(err("nobody", "kame", &map(&[])).contains("not on your team"));
    assert!(err("sid", "tinker", &map(&[])).contains("lead is not on your team"));
    assert!(err("sid", "sid", &map(&[])).contains("cannot lead itself"));
    assert!(err("kame", "sid", &map(&[("sid", "kame")])).contains("already works under kame"));
    assert!(err("kame", "pk", &map(&[("sid", "kame"), ("pk", "sid")])).contains("already works under"), "a longer loop");
    let deep = map(&[("lyra", "kame"), ("pk", "lyra"), ("sid", "pk")]);
    assert_eq!(MAX_ORG_DEPTH, 4);
    assert!(err("quill", "sid", &deep).contains("at most 4 levels"));
    assert!(err("kame", "quill", &deep).contains("at most 4 levels"), "moving a whole branch down counts its people");
    let mut with_quill = deep.clone();
    with_quill.insert("quill".into(), "pk".into());
    assert_eq!(check_reports_to("quill", Some("pk"), &deep, &team).unwrap(), with_quill);
    assert_eq!(check_reports_to("sid", None, &deep, &team).unwrap(), map(&[("lyra", "kame"), ("pk", "lyra")]), "None: reports to ARK");
}

#[test]
fn a_removed_leads_reports_move_up_and_a_removed_agents_entry_goes() {
    let raw = map(&[("lyra", "kame"), ("pk", "lyra"), ("sid", "pk")]);
    assert_eq!(resolve_org(&raw, &ids(&["kame", "pk", "sid"])), map(&[("pk", "kame"), ("sid", "pk")]));
    assert_eq!(resolve_org(&raw, &ids(&["pk", "sid"])), map(&[("sid", "pk")]));
    assert_eq!(resolve_org(&map(&[("a", "b"), ("b", "a")]), &ids(&["a", "b"])), map(&[]), "a hand-made loop is dropped");
}

#[test]
fn org_prompt_is_empty_without_leads_and_sorted_and_stable_with_them() {
    let n = names(&[("kame", "Kame"), ("lyra", "Lyricists"), ("pk", "ProjectK"), ("sid", "Sid")]);
    assert_eq!(org_prompt(&map(&[]), &n), "");
    let a = org_prompt(&map(&[("pk", "kame"), ("lyra", "kame"), ("kame", "sid")]), &n);
    let b = org_prompt(&map(&[("kame", "sid"), ("lyra", "kame"), ("pk", "kame")]), &n);
    assert_eq!(a, b, "the order of the map does not matter");
    assert!(a.starts_with("Team: Kame leads Lyricists, ProjectK; Sid leads Kame.\n"));
    assert!(a.contains("\nGive work for an agent with a lead to that lead (or plan it with plan_work); "));
    assert!(a.contains(" Call such an agent directly only when the user named it.\nA report that ends with \"Hand back:\" means its agent left the choice to you"));
}

#[test]
fn hand_back_only_counts_on_the_last_line_and_the_need_is_one_short_line() {
    assert_eq!(hand_back_need("Done. The table is filled in."), None, "a normal report");
    assert_eq!(hand_back_need("Hand back: a designer\nThen I stopped."), None, "not the last line");
    assert_eq!(hand_back_need("I could not do the logo.\n\nHand back: someone who can draw a logo  \n").as_deref(), Some("someone who can draw a logo"));
    assert_eq!(hand_back_need("hand back: a\u{2028}second\u{7}line\rhere").as_deref(), Some("a second line here"), "control and line separators become spaces");
    assert_eq!(hand_back_need(&format!("Hand back: {}", "x".repeat(1000))).unwrap().len(), HAND_BACK_CHARS);
    assert_eq!(hand_back_need("Hand back:   "), None, "no need given");
    let n = names(&[("kame", "Kame"), ("sid", "Sid")]);
    assert_eq!(
        hand_back_line("Kame", "a logo designer", &map(&[("kame", "sid")]), &n),
        "Kame handed back to ARK: a logo designer. Choose the agent for it (the chart: Sid leads Kame); the usual rules apply."
    );
    assert_eq!(hand_back_line("Kame", "a logo designer", &map(&[]), &n), "Kame handed back to ARK: a logo designer. Choose the agent for it; the usual rules apply.");
}

#[test]
fn an_agent_may_call_its_reports_and_peers_never_itself_or_up() {
    let team = ids(&["ana", "bo", "cy", "di", "ed"]);
    let chart = map(&[("bo", "ana"), ("cy", "ana"), ("di", "bo")]);
    let upper = |id: &str| Some(id.to_uppercase());
    assert_eq!(callable("ana", &chart, &team), Callable { reports: ids(&["bo", "cy"]), peers: ids(&["ed"]) });
    assert_eq!(callable("bo", &chart, &team), Callable { reports: ids(&["di"]), peers: ids(&["cy"]) });
    let problem = |a: &str, b: &str| delegation_problem(a, b, &chart, &team, &upper);
    assert_eq!(problem("ana", "bo"), None, "a direct report");
    assert_eq!(problem("bo", "cy"), None, "a peer under the same lead");
    assert_eq!(problem("ana", "ed"), None, "peers that report to ARK");
    assert!(problem("ana", "ana").unwrap().contains("yourself"));
    assert!(problem("di", "bo").unwrap().starts_with("BO is above you"));
    assert!(problem("di", "ana").unwrap().starts_with("ANA is above you"), "no call up past the lead either");
    assert!(problem("ana", "di").unwrap().starts_with("DI is not one of your reports or peers. You may call: BO (bo), CY (cy), ED (ed)."), "not a report's report");
    assert!(problem("di", "ed").unwrap().contains("You have no one to call."));
    assert_eq!(team_line("di", &chart, &team, &upper), "", "no one to call: no line, no Agent tool");
    let line = team_line("bo", &chart, &team, &upper);
    assert!(line.starts_with("Your reports: DI (di).\nYour peers: CY (cy).\n"));
    assert!(line.contains("Agent tool") && line.contains("\nYou report only by ending your turn"));
}

// ---- OrgChartTests.swift ----

fn agent<'a>(id: &'a str, reports_to: Option<&'a str>) -> ChartMember<'a> {
    ChartMember { id, role: "coder", reports_to }
}

#[test]
fn levels_follow_who_reports_to_whom() {
    let org = OrgChart::new(&[agent("kame", None), agent("lyric", Some("kame")), agent("sid", None), ChartMember { id: "tinker", role: "improver", reports_to: None }]);
    assert_eq!(org.agents, ["kame", "lyric", "sid"], "Tinker is not on the chart");
    assert!(Level::Lead.title() == "Manager" && Level::Worker.title() == "Agent");
    assert!(org.level(OrgChart::OWNER) == Level::Owner && org.level(OrgChart::ARK) == Level::Ceo);
    assert!(org.level("kame") == Level::Lead && org.level("lyric") == Level::Worker && org.level("sid") == Level::Worker);
    assert!(org.children(OrgChart::ARK) == ["kame", "sid"] && org.children("kame") == ["lyric"]);
    assert_eq!(org.depth("lyric"), 2);
}

#[test]
fn unknown_or_self_leads_report_to_ark() {
    let org = OrgChart::new(&[agent("a", Some("gone")), agent("b", Some("b"))]);
    assert!(org.parent("a") == Some(OrgChart::ARK) && org.parent("b") == Some(OrgChart::ARK));
}

#[test]
fn a_cycle_from_bad_data_falls_back_to_ark() {
    let org = OrgChart::new(&[agent("a", Some("b")), agent("b", Some("a"))]);
    assert!(org.lead_of.len() <= 1, "the loop is broken");
    assert!(org.agents.iter().all(|a| org.depth(a) <= 2));
}

#[test]
fn can_report_refuses_self_own_people_and_too_deep() {
    let org = OrgChart::new(&[agent("a", None), agent("b", Some("a")), agent("c", Some("b")), agent("d", Some("c")), agent("e", None)]);
    assert!(org.can_report("b", None) && org.can_report("b", Some(OrgChart::ARK)));
    assert!(!org.can_report("a", Some("a")), "not itself");
    assert!(!org.can_report("a", Some("c")), "not under one of its own people");
    assert!(org.can_report("e", Some("c")), "depth 4 is allowed");
    assert!(!org.can_report("e", Some("d")), "depth 5 is not");
    assert!(!org.can_report("a", Some("e")), "a's branch is three deep: under e it would reach five");
    assert!(!org.can_report("x", None), "unknown agent");
}

#[test]
fn layout_centres_parents_over_children_without_overlap() {
    let org = OrgChart::new(&[agent("a", None), agent("b", Some("a")), agent("c", Some("a")), agent("d", None)]);
    let size = (200.0, 80.0);
    let p = org.layout(size, 20.0, 40.0);
    assert_eq!(p[OrgChart::OWNER].0, p[OrgChart::ARK].0, "owner over ARK");
    assert_eq!(p["a"].0, (p["b"].0 + p["c"].0) / 2.0, "a lead centred over its people");
    assert!(p["b"].1 == p["c"].1 && p["b"].1 > p["a"].1 && p["a"].1 == p["d"].1);
    let mut row = [p["b"].0, p["c"].0];
    row.sort_by(f64::total_cmp);
    assert!(row[1] - row[0] >= size.0 + 20.0, "siblings do not overlap");
    assert!(p["d"].0 - p["a"].0 >= size.0 + 20.0);
}
