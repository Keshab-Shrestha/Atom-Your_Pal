//! How the app starts the runtime child. The choice is a pure function of the environment and the files,
//! so a test can run it with a fake lookup.
//!
//! - `ARK_RUNTIME=node`: start Node directly (the Swift app's way).
//! - Otherwise: start the `ark-runtime` forwarder (`ARK_RUNTIME_BIN`, else next to this app) with Node as its child.
//!   When no forwarder exists, fall back to Node directly.
//! - `ARK_RUNTIME_ARGS` replaces the program's arguments. `ARK_ROOT` (else `Resources/project-root` in the bundle,
//!   else the working folder) is the project folder that holds `.env`, `models/` and `apps/mac/src/main.ts`.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

const NODE_CANDIDATES: [&str; 2] = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
const NODE_ARGS: [&str; 3] = ["--env-file-if-exists=.env", "apps/mac/src/main.ts", "--island"];

/// What the plan reads from the outside: environment variables, whether a file exists, a file's text.
pub struct World<'a> {
    pub env: &'a dyn Fn(&str) -> Option<String>,
    pub exists: &'a dyn Fn(&Path) -> bool,
    pub read: &'a dyn Fn(&Path) -> Option<String>,
    /// The folder of this executable.
    pub exe_dir: Option<PathBuf>,
}

fn node_path(w: &World) -> String {
    (w.env)("ARK_NODE")
        .or_else(|| NODE_CANDIDATES.iter().find(|p| (w.exists)(Path::new(p))).map(|p| (*p).to_owned()))
        .unwrap_or_else(|| "node".to_owned())
}

fn root(w: &World) -> Option<PathBuf> {
    (w.env)("ARK_ROOT").map(PathBuf::from).or_else(|| {
        let marker = w.exe_dir.as_ref()?.join("../Resources/project-root");
        (w.read)(&marker).map(|t| PathBuf::from(t.trim())).filter(|p| !p.as_os_str().is_empty())
    })
}

pub fn plan(w: &World) -> Plan {
    let node = node_path(w);
    let cwd = root(w);
    let forwarder = (w.env)("ARK_RUNTIME_BIN").map(PathBuf::from).or_else(|| w.exe_dir.as_ref().map(|d| d.join("ark-runtime"))).filter(|p| (w.exists)(p));
    let custom: Option<Vec<String>> = (w.env)("ARK_RUNTIME_ARGS").map(|a| a.split_whitespace().map(str::to_owned).collect());
    let node_args = || NODE_ARGS.map(str::to_owned).to_vec();
    match forwarder.filter(|_| (w.env)("ARK_RUNTIME").as_deref() != Some("node")) {
        Some(bin) => {
            let mut args = vec![node];
            args.extend(custom.unwrap_or_else(node_args));
            Plan { program: bin.to_string_lossy().into_owned(), args, cwd }
        }
        None => Plan { program: node, args: custom.unwrap_or_else(node_args), cwd },
    }
}

/// The plan for the real environment.
pub fn real_plan() -> Plan {
    let env = |k: &str| std::env::var(k).ok();
    let exists = |p: &Path| p.exists();
    let read = |p: &Path| std::fs::read_to_string(p).ok();
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    plan(&World { env: &env, exists: &exists, read: &read, exe_dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(env: &[(&str, &str)], files: &[&str], marker: Option<&str>) -> Plan {
        let env = |k: &str| env.iter().find(|(n, _)| *n == k).map(|(_, v)| (*v).to_owned());
        let exists = |p: &Path| files.iter().any(|f| Path::new(f) == p);
        let read = |_: &Path| marker.map(str::to_owned);
        plan(&World { env: &env, exists: &exists, read: &read, exe_dir: Some("/A/ARK.app/Contents/MacOS".into()) })
    }

    #[test]
    fn forwarder_next_to_the_app_wraps_node() {
        let p = run(&[], &["/A/ARK.app/Contents/MacOS/ark-runtime", "/opt/homebrew/bin/node"], Some("/proj\n"));
        assert_eq!(p.program, "/A/ARK.app/Contents/MacOS/ark-runtime");
        assert_eq!(p.args[0], "/opt/homebrew/bin/node");
        assert_eq!(p.args.last().map(String::as_str), Some("--island"));
        assert_eq!(p.cwd, Some(PathBuf::from("/proj")));
    }

    #[test]
    fn node_fallback_when_no_forwarder_or_asked() {
        let p = run(&[], &["/opt/homebrew/bin/node"], None);
        assert_eq!((p.program.as_str(), p.cwd), ("/opt/homebrew/bin/node", None));
        let p = run(&[("ARK_RUNTIME", "node")], &["/A/ARK.app/Contents/MacOS/ark-runtime"], None);
        assert_eq!(p.program, "node");
    }

    #[test]
    fn env_overrides() {
        let p = run(&[("ARK_RUNTIME_BIN", "/x/fake"), ("ARK_RUNTIME_ARGS", "script.jsonl"), ("ARK_ROOT", "/r")], &["/x/fake"], None);
        assert_eq!((p.program.as_str(), p.args.as_slice()), ("/x/fake", &["node".to_owned(), "script.jsonl".to_owned()][..]));
        assert_eq!(p.cwd, Some(PathBuf::from("/r")));
    }
}
