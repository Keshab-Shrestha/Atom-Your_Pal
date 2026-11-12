//! Who reports to whom (ADR-278 Phase 4, slice 6): the chart in `org.json` beside the helpers file. A port of `resolveOrg`
//! and the reader of `createOrgStore` in `apps/mac/src/org.ts`. Rust only reads the chart; a broken file reads as no chart.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

/// The most levels below ARK.
const MAX_ORG_DEPTH: usize = 4;

/// The raw chart of `org.json` (`{ "reportsTo": { agent: lead } }`); entries that are not text are left out.
pub fn read_raw(path: &Path) -> BTreeMap<String, String> {
    let Ok(text) = std::fs::read_to_string(path) else { return BTreeMap::new() };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { return BTreeMap::new() };
    value["reportsTo"].as_object().map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default()
}

/// The leads above an agent, nearest first; `None` when the chain loops.
fn leads_of(agent: &str, map: &BTreeMap<String, String>) -> Option<Vec<String>> {
    let mut chain: Vec<String> = Vec::new();
    let mut lead = map.get(agent);
    while let Some(l) = lead {
        if l == agent || chain.contains(l) {
            return None;
        }
        chain.push(l.clone());
        lead = map.get(l);
    }
    Some(chain)
}

/// The chart as it stands: an entry of an agent that is gone is dropped; a report whose lead is gone moves up to that lead's own
/// lead (or ARK). Entries in a loop or too deep are dropped. `agent_ids` are the agents that can sit in the chart.
pub fn resolve(raw: &BTreeMap<String, String>, agent_ids: &[String]) -> BTreeMap<String, String> {
    let ids: HashSet<&String> = agent_ids.iter().collect();
    let mut moved = BTreeMap::new();
    for agent in raw.keys() {
        if !ids.contains(agent) {
            continue;
        }
        let mut seen: HashSet<&String> = HashSet::from([agent]);
        let mut lead = raw.get(agent);
        while let Some(l) = lead.filter(|l| !ids.contains(*l) && !seen.contains(*l)) {
            seen.insert(l);
            lead = raw.get(l);
        }
        if let Some(l) = lead.filter(|l| ids.contains(*l) && *l != agent) {
            moved.insert(agent.clone(), l.clone());
        }
    }
    let fits = |agent: &String| leads_of(agent, &moved).is_some_and(|chain| chain.len() < MAX_ORG_DEPTH);
    moved.iter().filter(|(a, _)| fits(a)).map(|(a, l)| (a.clone(), l.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(a, l)| ((*a).to_string(), (*l).to_string())).collect()
    }

    #[test]
    fn gone_agents_loops_and_deep_chains_are_dropped() {
        let ids: Vec<String> = ["a", "b", "c", "d", "e", "f", "x", "y"].iter().map(|s| (*s).to_string()).collect();
        // c reports to a gone lead "g", whose own lead is b: c moves up to b. x and y lead each other: dropped.
        let raw = map(&[("a", "b"), ("c", "g"), ("g", "b"), ("x", "y"), ("y", "x"), ("zz", "a")]);
        assert_eq!(resolve(&raw, &ids), map(&[("a", "b"), ("c", "b")]));
        // Too deep: an agent with more than three leads above it is dropped.
        let chain = map(&[("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f")]);
        assert_eq!(resolve(&chain, &ids), map(&[("c", "d"), ("d", "e"), ("e", "f")]));
    }
}
