# Reference

This folder holds research on other projects. The goal is ideas and improvements for ATOM.
Nothing here is code that ATOM runs. Do not copy source from these projects without checking the licence.

Write the files here in ASD-STE100 English, as the rest of the repository does.

## T3 Code

Source: https://github.com/pingdotgg/t3code (MIT licence, T3 Tools Inc.).
Read from a shallow clone at commit `2fbd4318` (2026-10-17).
To read the source again, run: `git clone --depth 1 https://github.com/pingdotgg/t3code`.
The clone is not kept in this repository.

Why: Keshab likes T3 Code and asked for its sessions, git source control, settings (providers, keybindings, connections, general),
and the right panel (files, open in, changes, devices) to be studied.

| File | Topic |
| --- | --- |
| `t3code-overview.md` | What T3 Code is, its parts, and a table that compares it with ATOM |
| `t3code-sessions-and-providers.md` | Sessions (threads), the provider layer, model choice, handoffs between providers |
| `t3code-settings-and-keybindings.md` | Every settings section, the Providers section, key bindings, how settings are stored |
| `t3code-git-and-source-control.md` | Git, worktrees, checkpoints, pull requests, source control hosts |
| `t3code-right-panel-devices-and-shell.md` | Right panel (Files, Changes, Devices, Open in), connections, desktop and mobile shell |
| `t3code-chat-timeline-and-messages.md` | How the chat thread is drawn: Markdown, code, tables, copy, work log, scroll |
| `t3code-composer-and-controls.md` | The chat box: editor, mentions, controls, queue, attachments, keys |
| `t3code-chat-plan.md` | A phased plan for ATOM's chat, made from the two chat files. Status: deferred |
| `t3code-ideas-for-atom.md` | One ranked list of ideas for ATOM, made from the first four topic files |

## How to use these files

1. Read `t3code-ideas-for-atom.md` (all areas) or `t3code-chat-plan.md` (the chat only) first. They are the short lists.
2. Each idea points to the topic file and the T3 Code path that shows how T3 Code does it.
3. To build an idea: follow CLAUDE.md (one capability at a time, an ADR, a TASK entry).
