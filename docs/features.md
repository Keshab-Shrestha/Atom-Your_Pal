# ARK features

This page lists all features of ARK. The [README](../README.md) gives a short summary. Each decision has an ADR in [DECISIONS.md](../DECISIONS.md).

- [Chat](#chat)
- [Home, ⌘K and ⌘J](#home-k-and-j)
- [Projects](#projects)
- [Voice](#voice)
- [Agents and the Board](#agents-and-the-board)
- [Automations](#automations)
- [Computer control](#computer-control)
- [Apps and panels](#apps-and-panels)
- [Memory and everyday tools](#memory-and-everyday-tools)
- [Usage on Home](#usage-on-home)
- [Phone and other tools](#phone-and-other-tools)
- [Look and settings](#look-and-settings)
- [Safety](#safety)

## Chat

Models and modes:

- ARK saves each chat. Continue any chat by voice or by text.
- Models: Claude (your signed-in Claude Code plan), Codex (your ChatGPT sign-in), Gemini CLI, GitHub Copilot CLI and OpenCode (ADR-270). The model picker shows provider logos and favourites.
- Copilot CLI and OpenCode give one text answer at the end. They get no ARK tools. They work in "Chat only" chats, not in project chats.
- ARK scans this Mac for 14 AI programs at start, every 10 minutes and on Rescan (ADR-269). Settings → AI model → "Found on this Mac" shows each program with its version, place and status. Switch each ready program on or off. A program that is off leaves the model picker.
- Thinking level per chat: the levels that the model gives, for example Low, Medium, High, Extra high or Max.
- Access per chat: Saved permissions, Ask before changes, Chat only or Full access.
- ARK opens the chat's session when you click the message box or open the mic. The first reply then starts sooner.

Replies:

- Replies use Markdown: tables, lists and code. Copy a reply as Markdown, plain text or rich text. Copy a table as Markdown, HTML, TSV or CSV.
- Charts: ask for a chart, and ARK draws bars, lines or a ring. "Copy table" copies the numbers.
- Result cards (ADR-276): a reply can hold an `ark-visual` block with a title and up to 6 blocks: stat tiles, bar rows, a line chart and tables. The card has Copy (Markdown tables) and Source (the JSON). A block that does not match the grammar shows as code. [docs/chat-visuals.md](chat-visuals.md) gives the grammar.
- Drawings: ask for a logo or an icon, and ARK draws it as SVG. Use Save SVG, Save PNG (1024 px) or Copy SVG.
- Images: an image file on your Mac shows in the reply. A web image loads only when you click "Show image".
- Image generation: Codex chats make photos and illustrations. ARK keeps each image in `data/images`.
- ARK states facts plainly and names the source when sources disagree.

The work log (ADR-263, ADR-268, ADR-275):

- A thinking pill says what ARK does now, for example "Reading a file".
- Each tool call is one row with its state and its time.
- The Worked header shows the time ("Worked for 9s"), a short tool summary and pills such as "3 tool calls" and "1 question". The newest turn keeps its steps open. Older turns fold to one line.
- The file review shows a diff card: "+N −M", the file name, hunks with line numbers, and green and red rows. "Reveal in Finder" shows the file.

Questions and the queue:

- Questions card (ADR-275): ARK can ask one to four numbered questions in one card. Each question has options with letter keys, a "Recommended" pill, "Other / none of these" and a note. "Send answers" (⌘↩) sends all answers. A blank question goes as unanswered.
- Queue (ADR-274): while ARK answers, Return or Tab puts your message in the queue. ⌘Return sends the next queued message now. Each queued message is a row: drag it to change the order, or use Edit, Send now and Remove.
- Catch me up (ADR-274): when a chat changed while you were away, "Catch me up" shows above the box. A click asks ARK for a short summary of what happened.
- Workers card (ADR-273): under the latest turn, one card lists each Board job that the chat started. A worker sits under the job that started it. A manager has a crown. A quiet job gets a hollow ring after 8 minutes with no output. Click a row to open the task. The "Workers n" chip above the box scrolls to the card.

Text and commands:

- Select text (⇧⌘A) shows the whole chat as one text. Drag or ⌘A selects across messages. ⌘C keeps bold, italic, underline and tables.
- Copy the whole chat. Find in chat (⌘F). Search all (⇧⌘F). Copy last reply (⇧⌘C).
- New chat (⌘N). New project (⇧⌘N).
- Type "/" for commands: ARK's own commands, your skills and your Claude commands from `~/.claude/commands`.
- Attach files and paste images. Quote a reply. Edit or retry a message in a new chat. Fork a chat.
- Pin and archive chats. Each chat has a brief, its task results and its saved history.

## Home, ⌘K and ⌘J

- The rail at the left has Home, Chats, Board, Automate (the Automations page), Apps, Brain, Plugins and Settings. Drag the pages into your own order.
- Back (⌘[) goes up from inside a page to that page. From any page, Back goes Home. From Home, Back goes to Chats (ADR-265).
- Home shows a greeting with your first name and today's one fact: what needs you, who works, or the day's tokens.
- Home has an "Ask ARK anything…" box that starts a chat, and your pinned panels.
- Home has three tiles: Need you, Running and Agents. One line under them shows today's tokens, the week's API-equivalent cost and cache hits.
- Home lists At work, Goals and Just in when they have rows (ADR-266).
- "ARK noticed": once a day ARK counts what goes wrong in its own log. Home shows up to three notes, for example a tool that keeps failing, a crash, a slow answer or chats that often end without an answer. "Fix it" starts a coding agent on a branch of ARK's own source. You review the diff and push it. ARK never merges. ARK never pushes a branch that changes permission, approval, update or dependency files. When the problem stops in the log, Home says "Fixed". If it comes back, the note comes back. Settings → Privacy turns this off.
- ⌘K command palette: one search box for actions, pages, Board views, your newest chats, agents, projects, Settings pages and themes.
- ⌘J "Ask an agent": a panel on any page. Pick an agent, see its latest tasks and give it a new task.
- The You page shows your name, what ARK remembers, your setup, your activity and your connections.
- First run (ADR-271): a sheet asks "What should ARK call you?". The macOS full name fills the field first. Change the name in Settings → General → "Your name".

## Projects

- A project is a folder or a git repository: local, a Git URL or GitHub.
- Project chats get file tools, commands and an isolated git worktree for each agent task.
- Workspace pane (⌥⌘R): Files, Changes (with Undo), Git, Browser, Terminal, Run and Details. ⌥⌘1 to ⌥⌘7 open each one.

## Voice

- Push-to-talk from any app: hold Control + Option. ARK answers out loud with Kokoro.
- Dictation into any text field: hold Right ⌘ + Right ⌥. Parakeet does the speech to text in the app.
- Quick actions: select text in any app and press Control + Option + K.
- Control + Option + Z shows or hides the island.
- Dictation can tidy punctuation and capitals with ARK (Settings → Dictation). ARK keeps your words as spoken unless the tidy text keeps every number and name.
- ARK can lower the Mac's sound while you speak.
- ARK can read agent reports and updates aloud, with a chime.
- Change each key in Settings.

## Agents and the Board

Agents:

- Each agent has a role, a kit and a `soul.md` (Personality, How it works, Rules, Lessons). ARK keeps a version of each edit.
- Kits: research (the web), folders (files) and think (no tools). In a Full access chat every agent has the tools of every kit.
- ARK answers known topics itself. It gives work to an agent only when you name one, ask for sources, change files or need many lookups.
- ARK makes a new agent when no agent fits. You approve it on a card.
- Plans: ARK splits a big job into portions, one agent for each. A plan card shows each handoff between portions.
- Plan notes (ADR-276): each portion has Note with Looks good, Clarify or Needs tests, and optional words. "Send notes" puts numbered feedback in the chat box. ARK does not send it for you.
- The same team rules apply in Claude chats and in Codex chats.

The team and its chain of command (ADR-261, ADR-272):

- Any agent can report to another agent, its manager. ARK is the CEO. The chart goes at most 4 levels below ARK.
- Work goes through managers: ARK gives a task for a worker to the worker's manager, and the manager assigns it. Exceptions: you name the agent, or the agent reports to ARK.
- Agents call agents: an agent can give part of its task to a direct report or a peer. Code checks each call: no call to itself or up the chart, no loop, at most 4 levels deep and at most 6 agents below one task.
- The same agent can run many jobs at the same time. In a Git project each job gets its own worktree.
- A child job shows under its parent on the Board. Its report goes back to its caller. Stopping a task stops its children.
- Hand back: an agent that should not pick the next agent ends its report with "Hand back: <need>". ARK then picks the agent.

The Board has three views:

- Flow: four lanes, Needs you, Running, To do and Done. Answer questions and approvals in the Needs you lane. A card opens an inspector. A manager's card shows its workers under it. On a narrow pane the Flow is a stacked list. A box above the team gives a task to an agent (ADR-257).
- Studio: the agents at their desks, drawn as a blueprint. Idle agents wait in Recharge. The light bulb switches between a navy print and a pale print.
- Team: the org chart on an endless board (ADR-262). Drag an agent onto a manager to move it to that team. Click an agent to set its availability, its manager, its soul, or to remove it.

Plugins and tools for agents:

- Skills: ARK offers to save a good task as a skill and improves a skill when you complain. A skills hub installs skills from pinned public repositories.
- MCP servers: paste a server's JSON config on the Plugins page. Test it, then give it to the agents you choose.
- Each agent can have its own browser profile.
- Paperclip: send tasks to your own Paperclip (`ARK_PAPERCLIP_URL`).

## Automations

The Automations page (ADR-265) holds workflows, routines and page watches. Each item shows its trigger, then its steps. Filters: All, On a timer, When something happens, By hand.

- Workflows: a trigger (by hand, a schedule, or a Board task that fails or finishes), then up to 8 steps. Each step is an agent's task. Each step gets the report of the step before. Draft, Test run, Publish.
- "Open canvas" shows a workflow on an endless board. Drag the nodes. "+" adds a step.
- Routines repeat one task on a timer, with an optional Telegram notice and webhook. Wake-ups run an agent at a set interval.
- Page watches: "Watch this page and tell me when it says slots are open". ARK reads the page on a timer with no model and tells you once.
- A routine can open ARK when ARK is closed (Settings → General). ARK opens in the background a minute before the routine.

## Computer control

- ARK looks at app windows and clicks, types and scrolls through the Cua Driver. Your real pointer does not move.
- A teal pointer shows where ARK acts, with a ring when it arrives.
- Computer control is off until you turn it on in Settings → Computer.
- ARK learns a button task after one checked run. When you say the same words again, ARK replays the task with no model, through the same checks. It stops at the first mismatch.

## Apps and panels

The Apps page (ADR-265) holds simple apps (panels) and custom apps in one grid. "New app" asks which kind to make. Each app has a tile in the rail.

- Custom apps: "Make me a habit tracker app". ARK writes a small app. You approve it. It runs inside ARK in a sandbox with no network. It keeps its own notes, and it can ask ARK a question if you allow it.
- Simple apps (panels): "a reading list and a counter for glasses of water". You approve it on a card. Pin it to show it on Home.
- Panel blocks: text, stat, progress, checklist, notes, counter, chart and button. Stats and progress can show live numbers, for example what needs you or today's tokens.
- You tick, add, count and click. A button acts only when you click it: it puts a prompt in a new chat for you to send, opens a page or runs a workflow.

## Memory and everyday tools

- ARK remembers facts that you ask it to keep. It also keeps lasting facts that you state in a chat, with no question. A "Remembered" row with Undo shows for 10 minutes. See, edit or forget each fact in Second brain. Settings → Privacy has the switch.
- ARK recovers earlier parts of a long chat.
- Brain: notes, links and source folders that ARK can read.
- Calendar, reminders, timers, weather, notes, music, opening apps, and "what is this page?" for the browser in front.

## Usage on Home

- Tokens and list-price dollars by day, by agent and by model. Trends for 7, 30 or 90 days.
- Plan use, cache hits, an activity heatmap and the team's git branches.

## Phone and other tools

- Telegram: talk to ARK, answer Needs you, steer tasks and read reports ([docs/telegram.md](telegram.md)).
- Phone: use ARK from a phone with Tailscale ([docs/mobile.md](mobile.md)).
- Local API on `127.0.0.1` (off by default) and an MCP server for Claude Code and other MCP clients ([README](../README.md#use-ark-from-other-tools)).

## Look and settings

- 9 themes: Void, Daylight, Paper & Teal, Ink & Sage, Midnight Sapphire, Graphite & Champagne Gold, Royal Plum & Lavender, Obsidian & Electric Teal and Graphite & Ember. Paper & Teal and Ink & Sage use serif page titles.
- 8 typefaces: System, Helvetica Neue, Source Sans, Work Sans, Lato, Poppins, Nunito and Mulish. Four text sizes: Small, Default, Large and Larger.
- Material: Ambient glass (the default) or Flat (ADR-255). Reduce Transparency always draws Flat.
- Translucent window (ADR-277): Settings → Appearance → Window. The desktop shows through the window, blurred and tinted. Strength: Low, Medium or High. It is off by default. It needs Ambient glass. Reduce Transparency and Increase Contrast keep the window opaque.
- Settings → Defaults: the model, thinking and access for new chats, where ⌘N opens, the start page and the usage range.
- Pal: a 2D mascot that shows when ARK listens, thinks, speaks or asks. It flies to point at things.
- Settings → General → "This build" shows the version, the commit and the build time.
- A copy built from source updates itself from Settings → General, after you click Update.

## Safety

- Files: agents work in your home folder and on external drives. ARK protects `~/Library`, hidden folders, secrets, ARK's data, git's own files and identity, and bank, tax and medical documents.
- A change to an existing file asks once for each file, except in Full access. ARK keeps a copy of each changed file for Undo.
- Network commands, sudo, system settings and git history rewrites ask first. Then they run outside the sandbox.
- A git push asks first. Then ARK pushes the task's own branch to origin, never with force.
- ARK always refuses permanent deletes (files go to the Trash), remote changes and keychain reads.
- After an agent reads web text, lasting changes, MCP calls and outside-sandbox commands ask again, also in Full access.
- An approval card that gets no answer expires. ARK tells the agent. ARK does not count it as a refusal.
- Agent calls to other agents follow code rules, not model choices (ADR-272).
- Secrets in the activity timeline show as `[hidden]`. Logs hold ids, states and timings, never your words.
- ARK uses your signed-in Claude Code, Codex, Gemini CLI, Copilot CLI and OpenCode. It never reads their logins. It removes API keys and GitHub tokens from the environment of these programs.

Details: [SECURITY.md](../SECURITY.md).
