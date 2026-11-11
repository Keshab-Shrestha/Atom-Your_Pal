//! Parity with the TypeScript code: each `tests/fixtures/<module>.json` holds inputs and the answers the TypeScript
//! code gave (`node rust/scripts/gen-fixtures.ts`). Every Rust answer must be the same JSON value.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};

fn str_arg(args: &[Value], i: usize) -> &str {
    args[i].as_str().unwrap_or_else(|| panic!("argument {i} is not text: {args:?}"))
}

fn strings(value: &Value) -> Option<Vec<String>> {
    value.as_array().map(|items| items.iter().map(|v| v.as_str().unwrap().to_string()).collect())
}

/// Runs every case of a fixture and lists each case whose answer differs.
fn check(module: &str, run: impl Fn(&str, &[Value]) -> Value) -> usize {
    let path = format!("{}/tests/fixtures/{module}.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let fixture: Value = serde_json::from_str(&text).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(!cases.is_empty(), "{module}: no cases");
    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let args = case["args"].as_array().unwrap();
            let got = run(case["fn"].as_str().unwrap(), args);
            (got != case["out"]).then(|| format!("{} {args:?}\n  TypeScript: {}\n  Rust:       {got}", case["fn"], case["out"]))
        })
        .collect();
    assert!(wrong.is_empty(), "{module}: {} of {} cases differ:\n{}", wrong.len(), cases.len(), wrong.join("\n"));
    cases.len()
}

fn reports_to(value: &Value) -> ark_core::org::ReportsTo {
    value.as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect()
}

#[test]
fn org() {
    use ark_core::org::*;
    check("org", |name, args| {
        let ids = |i: usize| strings(&args[i]).unwrap();
        let names = |i: usize| {
            let map = args[i].clone();
            move |id: &str| map.get(id).and_then(Value::as_str).map(str::to_string)
        };
        match name {
            "orgAgentIds" => {
                let list = args[0].as_array().unwrap();
                let members: Vec<Member<'_>> = list.iter().map(|m| Member { id: m["id"].as_str().unwrap(), role: m["role"].as_str().unwrap() }).collect();
                json!(org_agent_ids(&members))
            }
            "checkReportsTo" => match check_reports_to(str_arg(args, 0), args[1].as_str(), &reports_to(&args[2]), &ids(3)) {
                Ok(map) => json!(map),
                Err(error) => json!({ "error": error }),
            },
            "resolveOrg" => json!(resolve_org(&reports_to(&args[0]), &ids(1))),
            "orgPrompt" => json!(org_prompt(&reports_to(&args[0]), &names(1))),
            "handBackNeed" => json!(hand_back_need(str_arg(args, 0))),
            "handBackLine" => json!(hand_back_line(str_arg(args, 0), str_arg(args, 1), &reports_to(&args[2]), &names(3))),
            "callable" => {
                let c = callable(str_arg(args, 0), &reports_to(&args[1]), &ids(2));
                json!({ "reports": c.reports, "peers": c.peers })
            }
            "delegationProblem" => json!(delegation_problem(str_arg(args, 0), str_arg(args, 1), &reports_to(&args[2]), &ids(3), &names(4))),
            "teamLine" => json!(team_line(str_arg(args, 0), &reports_to(&args[1]), &ids(2), &names(3))),
            other => panic!("no Rust port for {other}"),
        }
    });
}

#[test]
fn policy() {
    use ark_core::policy::*;
    check("policy", |name, args| match name {
        "classifyCommand" => match classify_command(str_arg(args, 0), "the user") {
            CommandVerdict::Allow => json!({ "verdict": "allow" }),
            CommandVerdict::Ask { reason, outside } => json!({ "verdict": "ask", "reason": reason, "outside": outside }),
            CommandVerdict::Refuse { reason } => json!({ "verdict": "refuse", "reason": reason }),
        },
        "isPushCommand" => json!(is_push_command(str_arg(args, 0))),
        "hasGitPart" => json!(has_git_part(str_arg(args, 0))),
        "isInside" => json!(is_inside(str_arg(args, 0), str_arg(args, 1))),
        "expandHome" => json!(expand_home(str_arg(args, 0), str_arg(args, 1))),
        "isImportantName" => json!(is_important_name(str_arg(args, 0))),
        "toolPaths" => json!(tool_paths(str_arg(args, 0), args[1].as_object().unwrap())),
        "folderForTask" => json!(folder_for_task(str_arg(args, 0), str_arg(args, 1))),
        "parseWriteScope" => match parse_write_scope(args.first()) {
            Ok(paths) => json!(paths),
            Err(error) => json!({ "error": error }),
        },
        "writeScopesOverlap" => {
            json!(write_scopes_overlap(strings(&args[0]).as_deref(), strings(&args[1]).as_deref()))
        }
        other => panic!("no Rust port for {other}"),
    });
}
