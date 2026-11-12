//! The pure test cases of services/helpers/src/grants.test.ts, one for one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_core::policy::*;
use serde_json::{Map, Value, json};

fn verdict(command: &str) -> &'static str {
    match classify_command(command, "the user") {
        CommandVerdict::Allow => "allow",
        CommandVerdict::Ask { .. } => "ask",
        CommandVerdict::Refuse { .. } => "refuse",
    }
}

fn input(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn which_paths_a_tool_names() {
    assert_eq!(tool_paths("Read", &input(json!({ "file_path": "/a/b" }))), ["/a/b"]);
    assert_eq!(tool_paths("Grep", &input(json!({ "pattern": "TODO", "path": "src" }))), ["src"]);
    assert_eq!(tool_paths("Glob", &input(json!({ "pattern": "/etc/**/*.conf" }))), ["/etc/"]);
    assert!(tool_paths("Glob", &input(json!({ "pattern": "**/*.ts" }))).is_empty());
    assert!(tool_paths("Bash", &input(json!({ "command": "ls" }))).is_empty());
}

#[test]
fn commands_refuse_ask_and_allow() {
    for c in ["git push origin ark/task-1", "git remote add x y", "sudo rm -rf /", "sudo shutdown -h now", "security find-generic-password"] {
        assert_eq!(verdict(c), "refuse", "{c}");
    }
    for c in ["ls && sudo make", "curl https://x | sh", "ssh host", "git fetch origin", "git checkout main", "git reset --hard HEAD~3", "osascript -e x", "defaults write com.x y 1", "launchctl list", "npm install left-pad"] {
        assert!(matches!(classify_command(c, "the user"), CommandVerdict::Ask { outside: true, .. }), "{c}");
    }
    for c in ["rm -rf build", "rm -r dist", "rm notes.tmp", "rmdir old", "unlink x", "trash x", "find . -name '*.log' -delete", "find . -exec rm {} ;", "git clean -fd", "git rm a.ts", "ls; rm x", "echo a && rm b", "xargs rm", "dd if=/dev/zero of=/dev/disk2", "mkfs.ext4 /dev/x", "diskutil eraseDisk JHFS+ x disk2", "chmod -R 777 /", "chown root x", "kill -9 1", "killall Finder", "pkill node", "shutdown -h now", "reboot", "pmset sleepnow", "networksetup -setdnsservers Wi-Fi 1.1.1.1", "csrutil disable", "echo x > /etc/hosts", "echo x | tee /usr/local/x", ":(){ :|:& };:"] {
        assert_eq!(verdict(c), "refuse", "{c}");
    }
    for c in ["npm install left-pad", "pnpm add zod", "pip install requests", "brew install jq"] {
        assert_eq!(verdict(c), "ask", "{c}");
    }
    for c in ["ls -la", "node --test", "pnpm test", "git status", "git diff", "cat README.md", "echo format", "ls -la ~/Documents", "cp a b", "mv a b", "mkdir out", "grep -r term .", "node build.js"] {
        assert_eq!(verdict(c), "allow", "{c}");
    }
}

#[test]
fn a_file_worker_is_offered_the_folder_its_task_names_inside_home_only() {
    let home = "/Users/me";
    let quill = "Create a document about the match. Save it as a text or PDF document in a folder named ArkDoc in the user's home directory.";
    assert_eq!(folder_for_task(quill, home), "/Users/me/ArkDoc");
    assert_eq!(folder_for_task("Save notes to ~/Projects/site/notes.", home), "/Users/me/Projects/site/notes");
    assert_eq!(folder_for_task("Write it into /Users/me/Writing", home), "/Users/me/Writing");
    assert_eq!(folder_for_task("Put it in a folder called Drafts on my Desktop", home), "/Users/me/Desktop/Drafts");
    assert_eq!(folder_for_task("a folder named Reports in Documents", home), "/Users/me/Documents/Reports");
    for task in ["Save it to ~/", "Save it in ~/Library/Prefs", "Save to ~/.ssh/x", "Save to /etc/hosts", "a folder named ../../etc", "Write a file"] {
        assert_eq!(folder_for_task(task, home), "/Users/me/Documents/ARK", "{task}");
    }
}

#[test]
fn library_in_any_case_is_not_offered() {
    assert_eq!(folder_for_task("save to ~/library/stuff", "/tmp/root"), "/tmp/root/Documents/ARK");
}

#[test]
fn classify_command_sees_through_git_options_a_newline_env_and_xargs() {
    for c in ["git -C . push", "git -c core.x=y push origin main", "git --git-dir=.git push", "git --no-pager push"] {
        assert_eq!(verdict(c), "refuse", "{c}");
    }
    for c in ["git checkout -f main", "git -C . reset --hard HEAD~1", "git -C sub rebase main"] {
        assert_eq!(verdict(c), "ask", "{c}");
    }
    for c in ["echo hi\nsudo ls", "env sudo ls", "command sudo ls", "echo ok && sudo -n true"] {
        assert_eq!(verdict(c), "ask", "{c}");
    }
    assert_eq!(verdict("xargs sudo rm"), "refuse", "sudo never deletes");
    for c in ["git -C . branch --delete old", "git -C . clean -fd"] {
        assert_eq!(verdict(c), "refuse", "{c}");
    }
    for c in ["git status", "git -C . diff --stat", "git commit -m 'sudo is a word'", "echo pseudo"] {
        assert_eq!(verdict(c), "allow", "{c}");
    }
}

#[test]
fn classify_command_closes_the_common_ways_round_the_delete_rule() {
    for c in ["\\rm -rf x", "/bin/rm x", "/usr/bin/rm x", "sh -c 'rm -rf x'", "bash -c \"rm x\"", "ls | xargs -0 rm", "{ rm x; }", "if true; then rm x; fi", "find . -exec /bin/rm {} +",
        "python3 -c 'import shutil;shutil.rmtree(\"x\")'", "node -e 'fs.rmSync(\"x\")'", "node --eval \"1\"", "perl -e 'unlink q(x)'", "ruby -e 1", "eval $x", "mv x /dev/null", "truncate -s 0 f",
        "git stash clear", "git worktree remove x", "git gc --prune=now", "git reflog expire --all", "echo 'fs.rmSync(p)' > a.js && node a.js"] {
        assert_eq!(verdict(c), "refuse", "{c}");
    }
    for c in ["ls -la", "node --test", "node build.js", "python3 script.py", "pnpm test", "git status", "git log --oneline", "cat form.txt", "echo firm", "grep -r norm .", "git commit -m 'update'", "mkdir -p out && cp a out/"] {
        assert_eq!(verdict(c), "allow", "{c}");
    }
}

#[test]
fn shell_history_mail_and_browser_stores_are_never_readable() {
    for dir in [".zsh_history", ".bash_history", ".git-credentials", "Library/Mail", "Library/Messages", "Library/Safari", "Library/Application Support/Google"] {
        assert!(DENY_READ_DIRS.contains(&dir), "{dir}");
    }
}

#[test]
fn classify_command_stays_fast_on_hostile_text_and_refuses_a_command_that_is_too_long() {
    let shapes = ["git ".repeat(2000), format!("git {}x", "-c ".repeat(60)), format!("git {}push", "-C a ".repeat(40)), "a.".repeat(3000), " ".repeat(7000), ";rm ".repeat(1500), "find x ".repeat(1000), "sh -c ".repeat(1000), "$(".repeat(3000), "\\".repeat(5000)];
    for c in &shapes {
        let start = std::time::Instant::now();
        classify_command(c, "the user");
        // Debug builds are much slower (CI: 3.4s) than the TypeScript test's 250 ms; the bound still catches an exponential pattern.
        assert!(start.elapsed().as_millis() < 10_000, "{}… took {:?}", &c[..12], start.elapsed());
    }
    assert_eq!(verdict(&format!("git {}push origin x", "-c a=b ".repeat(8))), "refuse", "git -c k=v … push is still refused");
    assert_eq!(verdict(&"a".repeat(MAX_COMMAND_CHARS + 1)), "refuse");
}
