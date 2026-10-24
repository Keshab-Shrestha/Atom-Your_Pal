import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { RowMenu } from "./RowMenu.tsx";
import { ACCESS_MODES, buildEntries, entryKey, filterEntries, isValidModelId, modelName, needsClaudeOrCodex, reasoningTitle } from "./models.ts";
import type { ChatAccessMode, InfoEvent } from "./protocol.ts";
import type { ChatSettings as Settings } from "./store.ts";

export interface ChatSettingsProps {
  info: InfoEvent | undefined;
  settings: Settings;
  /** The provider and model the next turn uses. */
  effective: { provider: string; model: string } | undefined;
  /** Why thinking and access cannot change now; undefined when they can. */
  why: string | undefined;
  /** The model can be changed on any writable chat, even while busy. */
  modelWhy: string | undefined;
  onModel: (choice: { provider: string; model: string } | undefined) => void;
  onThinking: (effort: string) => void;
  onAccess: (mode: ChatAccessMode) => void;
  onRefreshModels: () => void;
}

/** The three choices that shape the next turn of this chat: model, thinking and access. Each says why it is unavailable instead of vanishing. */
export function ChatSettings(p: ChatSettingsProps) {
  const { info, settings, effective } = p;
  const reasoning = settings.reasoning;
  const access = settings.access;
  const accessMode = ACCESS_MODES.find((m) => m.mode === access);
  const limited = needsClaudeOrCodex(reasoning?.provider ?? effective?.provider);
  return (
    <div class="controls">
      {info && effective ? <ModelPicker info={info} effective={effective} why={p.modelWhy} onChoose={p.onModel} /> : null}
      {reasoning ? (
        <RowMenu
          variant="inline"
          up
          label={`Thinking for this chat: ${reasoning.levels.length === 0 ? "unavailable" : reasoningTitle(reasoning.effective)}`}
          disabledWhy={p.why}
          items={[
            ...(reasoning.levels.length > 0
              ? [
                  { label: `Default (${reasoningTitle(reasoning.default)})`, checked: reasoning.selected === undefined, onSelect: () => p.onThinking("") },
                  ...reasoning.levels.map((level) => ({ label: reasoningTitle(level), checked: reasoning.selected === level, onSelect: () => p.onThinking(level) })),
                ]
              : [{ label: "Refresh model catalog", onSelect: p.onRefreshModels }]),
          ]}
          footer={reasoning.note ?? "Applies to the next message. More thinking can take longer."}
        >
          <Icon name="brain" size={14} /> {reasoning.levels.length === 0 ? "Thinking unavailable" : `Thinking: ${reasoningTitle(reasoning.effective)}`}
          <Icon name="down" size={12} />
        </RowMenu>
      ) : null}
      {accessMode ? (
        <RowMenu
          variant="inline"
          up
          label={`Access for this chat: ${accessMode.title}`}
          disabledWhy={p.why}
          items={ACCESS_MODES.map(({ mode, title }) => ({
            label: title,
            checked: mode === access,
            onSelect: () => p.onAccess(mode),
            disabledWhy: mode !== "checked" && limited ? "Chat only, Ask before changes and Full access require Claude or Codex." : undefined,
          }))}
          footer={
            <>
              <span>{accessMode.detail}</span>
              {access === "full" ? <span> Full access stays on after restart. New and forked chats use Saved permissions.</span> : null}
              <span> Switching modes keeps chat history and saved permissions.</span>
            </>
          }
        >
          <Icon name={access === "full" ? "unlock" : "lock"} size={14} /> {accessMode.title}
          <Icon name="down" size={12} />
        </RowMenu>
      ) : null}
    </div>
  );
}

function ModelPicker({ info, effective, why, onChoose }: { info: InfoEvent; effective: { provider: string; model: string }; why: string | undefined; onChoose: ChatSettingsProps["onModel"] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string | undefined>();
  const [cursor, setCursor] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customId, setCustomId] = useState("");
  const [customProvider, setCustomProvider] = useState(effective.provider);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => buildEntries(info.providers, effective.provider, effective.model), [info.providers, effective.provider, effective.model]);
  const shown = useMemo(() => filterEntries(entries, query, provider), [entries, query, provider]);
  const label = modelName(info.providers, effective.provider, effective.model);

  const close = (refocus = true) => {
    setOpen(false);
    setCustom(false);
    setQuery("");
    setProvider(undefined);
    setCursor(0);
    if (refocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => setCursor(0), [query, provider]);

  const choose = (entry: (typeof shown)[number] | undefined) => {
    if (!entry || !entry.available) return;
    close();
    onChoose({ provider: entry.provider, model: entry.model });
  };
  const customOk = isValidModelId(customId.trim()) && (info.providers.find((x) => x.id === customProvider)?.available ?? false);

  return (
    <div class="picker-wrap" ref={root}>
      <button
        type="button"
        ref={trigger}
        class="inline-more"
        aria-label={`Model for this chat: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={why ? "true" : undefined}
        title={why ?? "Choose the provider and model for this chat"}
        onClick={() => !why && setOpen(!open)}
      >
        <Icon name="sparkle" size={14} /> <span class="picker-label">{label}</span>
        <Icon name="down" size={12} />
      </button>
      {open ? (
        <div
          class="picker"
          role="dialog"
          aria-label="Choose a model"
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), custom ? setCustom(false) : close());
          }}
        >
          {custom ? (
            <form
              class="picker-custom"
              onSubmit={(e) => {
                e.preventDefault();
                if (!customOk) return;
                close();
                onChoose({ provider: customProvider, model: customId.trim() });
              }}
            >
              <button type="button" class="link-btn" onClick={() => setCustom(false)}>‹ Models</button>
              <h3 class="picker-title">Custom model</h3>
              <label class="small muted" for="custom-provider">Provider</label>
              <select id="custom-provider" value={customProvider} onChange={(e) => setCustomProvider(e.currentTarget.value)}>
                {info.providers.map((x) => <option key={x.id} value={x.id} disabled={!x.available}>{x.name}{x.available ? "" : " (not available)"}</option>)}
              </select>
              <label class="small muted" for="custom-id">Model id</label>
              <input id="custom-id" value={customId} autoFocus aria-invalid={customId !== "" && !customOk ? "true" : undefined} onInput={(e) => setCustomId(e.currentTarget.value)} placeholder="for example gpt-5.5" />
              <p class="small muted">Letters, digits and . _ : - only. The provider checks the model when you send.</p>
              <button type="submit" class="btn btn-primary" disabled={!customOk}>Use this model</button>
            </form>
          ) : (
            <>
              <input
                ref={search}
                class="picker-search"
                role="combobox"
                aria-expanded="true"
                aria-controls="picker-list"
                aria-activedescendant={shown[cursor] ? `opt-${cursor}` : undefined}
                aria-label="Search models"
                placeholder="Search models…"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") (e.preventDefault(), setCursor(Math.min(cursor + 1, shown.length - 1)));
                  else if (e.key === "ArrowUp") (e.preventDefault(), setCursor(Math.max(cursor - 1, 0)));
                  else if (e.key === "Enter" && !e.isComposing) (e.preventDefault(), choose(shown[cursor]));
                }}
              />
              <div class="picker-filter" role="group" aria-label="Provider">
                <button type="button" class="chip-btn" aria-pressed={provider === undefined} onClick={() => setProvider(undefined)}>All</button>
                {info.providers.map((x) => (
                  <button key={x.id} type="button" class="chip-btn" aria-pressed={provider === x.id} onClick={() => setProvider(x.id)}>{x.name}</button>
                ))}
              </div>
              <ul id="picker-list" class="picker-list" role="listbox" aria-label="Models">
                {shown.length === 0 ? <li class="muted small picker-empty">No model matches “{query}”.</li> : null}
                {shown.map((entry, i) => {
                  const current = entry.provider === effective.provider && entry.model === effective.model;
                  return (
                    <li
                      key={entryKey(entry)}
                      id={`opt-${i}`}
                      role="option"
                      aria-selected={current}
                      aria-disabled={entry.available ? undefined : "true"}
                      class={`picker-opt${i === cursor ? " cursor" : ""}`}
                      onMouseMove={() => setCursor(i)}
                      onClick={() => choose(entry)}
                    >
                      <span class="menu-check" aria-hidden="true">{current ? <Icon name="check" size={14} /> : null}</span>
                      <span class="picker-opt-name">{entry.name}</span>
                      <span class="muted small">{entry.providerName}{entry.available ? "" : " · not available"}</span>
                    </li>
                  );
                })}
              </ul>
              <div class="picker-foot">
                <button type="button" class="link-btn" onClick={() => { close(); onChoose(undefined); }}>Use app / project default</button>
                <button type="button" class="link-btn" onClick={() => setCustom(true)}>Custom model…</button>
              </div>
              <p class="small muted picker-note">Applies to the next turn in this chat.</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
