# Run ARK

Install the two independent workspaces:

```sh
pnpm install --ignore-scripts
pnpm --dir atom install --ignore-scripts
pnpm ark:dev
```

Use the root package's supported Node version. The launcher creates isolated `.ark` settings, keeps T3's normal providers and chooses approval-required access for a fresh profile. It starts the web/server environment with ATOM feature services enabled. Open the development runner's address and choose **Workspace** for the feature pages, or use chat as usual.

`pnpm ark:setup` creates isolated settings without starting services. ATOM does not appear in the provider picker. The previous `atom:*` ACP launcher has been removed.

The server owns the feature runtime; do not launch a second process against its data. A duplicate owner is refused by the existing lock. Backend dependencies remain under `atom/`; feature settings use `atom/config/ark-features.json` and state uses `atom/data`, regardless of ambient ATOM state-path variables; provider credentials for ordinary chat remain managed by T3's provider integrations.

Use Workspace to add agents, edit versioned profiles and skill assignments, change Ready/Paused availability, and create or edit notes. Chat can retrieve saved facts, notes and ARK-owned or personal skill pages on demand. Sources previews a selected folder before importing Markdown, text and optionally PDF/Word documents; refresh preserves local corrections and reports conflicts. Disconnect asks before removing the imported notes.

Chat-linked work opens the native conversation and its approval/Stop controls. Schedules uses the existing scheduled-task system. Earlier ATOM jobs are historical; the feature runtime does not start the old routine clock or task queue. Agent-profile launches stay disabled pending enforcement of their tool/folder restrictions. Workspace → Board → Access shows each profile's planned tool kit and launch blockers, and supports previewing, confirming and removing folders. Existing folder grants need one identity review; later checks flag missing or replaced directories. Folder identity records persist separately in `atom/data/ark-agent-folders.json`. The companion integration remains to be ported. No installed history is imported automatically.

Workspace → Draft a reply uses an enabled Claude or Codex model in a fresh, tool-free session. Paste the message, describe the reply and generate an unsent draft. Advanced context is optional: search locally, review previews and check only the excerpts to include. Selections reset when leaving the surface. Form text and the last draft remain in this client’s memory while navigating; they are not restored after a reload. Stop cancels the draft, and leaving the surface cancels it automatically. Copying a draft does not send it.

Claude requires CLI support for safe/restricted mode and refuses managed MCP configuration. Codex requires permission-profile support and verifies isolation before sending the draft content. Unsupported versions or providers fail without a fallback model. Provider credentials stay with the native provider integration.

Settings → Computer use configures the selected environment; the same controls are in Workspace → Computer. Computer control is off initially and requires the Mac host's Cua driver plus macOS Accessibility/Screen Recording access. The feature runtime uses the installed `~/.local/bin/cua-driver`; this checkout does not yet package that helper into ARK's desktop distribution. Enabling ARK's feature does not change macOS permissions.

Each chat asks before its first computer observation or action. That access is remembered for the chat, while sensitive actions still require a separate Allow once. Computer activity and Stop stay visible across pages. Declining ends computer work for the current turn. If an action stops or reports uncertainty, ask for a fresh observation before continuing; ARK never automatically replays input. An unconfirmed Stop requires restarting ARK. Forget remembered chat access from Computer settings to make chats ask again.

Keep fast decisions Off to use only the main model, select the installed local Laya model, or choose Jev and add its key. Optional Laya backup applies when Jev is unavailable. Jev shares bounded task/window labels and prepared plans with its cloud service, excluding screenshots and editable-field values. Neither decider grants access or verifies task completion.

Web and desktop chat have opt-in dictation and reply read-aloud. Dictation records on the requesting client, sends mono 16 kHz audio to the connected environment's local Whisper, and appends the transcript to the unsent composer. It never starts ATOM's legacy voice conversation. Read-aloud returns local Kokoro audio to the client, rather than using host speakers. Mobile voice controls remain to be ported.

Install `whisper-cli` and the configured `ATOM_STT_MODEL` under the feature runtime before using dictation. Kokoro needs its configured voice/model cached under `atom/models/huggingface`; ARK's read-aloud worker refuses model downloads. Existing ATOM voice configuration supplies the voice and precision. No microphone or voice model is warmed at feature startup. Each recording is bounded to 60 seconds and each synthesized reply to 8,000 characters / three minutes of output. These processing budgets do not truncate chat messages. Real microphone, local-model and playback checks remain part of the final adaptation verification.
