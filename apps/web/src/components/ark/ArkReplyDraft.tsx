import { randomUUID } from "../../lib/utils";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ArkDraftContextItem, EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createModelSelection } from "@t3tools/shared/model";
import { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { resolveAppModelSelectionState } from "../../modelSelection";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentProviders } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const formAtom = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make({
    conversation: "",
    intent: "",
    background: "",
    examples: "",
    modelSelection: null as ModelSelection | null,
    output: "",
    outputModel: "",
  }).pipe(Atom.keepAlive),
);

export function ArkReplyDraft({ environmentId }: { environmentId: EnvironmentId }) {
  const form = useAtomValue(formAtom(environmentId));
  const setForm = useAtomSet(formAtom(environmentId));
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const choices = providers
    .filter(
      (provider) =>
        provider.enabled && (provider.driver === "claudeAgent" || provider.driver === "codex"),
    )
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.instanceId}:${model.slug}`,
        label: `${provider.displayName ?? (provider.driver === "claudeAgent" ? "Claude" : "Codex")} · ${model.name ?? model.slug}`,
        selection: createModelSelection(provider.instanceId, model.slug),
      })),
    );
  const settings = useEnvironmentSettings(environmentId);
  const defaultSelection = resolveAppModelSelectionState(
    settings,
    providers.filter(
      (provider) =>
        provider.enabled && (provider.driver === "claudeAgent" || provider.driver === "codex"),
    ),
  );
  const selection = form.modelSelection ?? defaultSelection;
  const chosen = choices.find(
    (choice) =>
      choice.selection.instanceId === selection.instanceId &&
      choice.selection.model === selection.model,
  );
  const canGenerate = useAtomValue(
    serverEnvironment.arkDraftGenerate.permissionAtom(environmentId),
  );
  const canSearch = useAtomValue(serverEnvironment.arkDraftLookup.permissionAtom(environmentId));
  const generate = useAtomCommand(serverEnvironment.arkDraftGenerate, { reportFailure: false });
  const lookup = useAtomCommand(serverEnvironment.arkDraftLookup, { reportFailure: false });
  const cancel = useAtomCommand(serverEnvironment.arkDraftCancel);
  const active = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly ArkDraftContextItem[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "reply draft",
    onError: (error) => setError(error.message),
  });
  const stop = useStableCallback(async () => {
    const requestId = active.current;
    if (requestId) await cancel({ environmentId, input: { requestId } });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Leaving this surface must cancel its isolated provider process.
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );
  const search = async () => {
    setSearching(true);
    setError("");
    setSelected([]);
    setItems([]);
    setSearched(false);
    try {
      const result = await lookup({ environmentId, input: { query } });
      if (result._tag === "Success") {
        setItems(result.value.items);
        setSearched(true);
      } else {
        const error = squashAtomCommandFailure(result);
        setError(error instanceof Error ? error.message : "Context search failed.");
      }
    } finally {
      setSearching(false);
    }
  };
  const draft = async () => {
    if (active.current || !chosen) return;
    const requestId = randomUUID();
    active.current = requestId;
    setPending(true);
    setError("");
    try {
      const result = await generate({
        environmentId,
        input: {
          requestId,
          modelSelection: selection,
          conversation: form.conversation,
          intent: form.intent,
          background: form.background,
          examples: form.examples,
          context: items
            .filter((item) => selected.includes(item.id))
            .map(({ id, revision }) => ({ id, revision })),
        },
      });
      if (result._tag === "Success")
        setForm((current) => ({
          ...current,
          output: result.value.text,
          outputModel: chosen.label,
        }));
      else {
        const error = squashAtomCommandFailure(result);
        setError(
          error instanceof Error ? error.message : "Drafting failed. Your source text is kept.",
        );
      }
    } finally {
      if (active.current === requestId) active.current = null;
      setPending(false);
    }
  };
  return (
    <section className="grid gap-5 rounded-xl border border-border/60 bg-card/40 p-5">
      <div>
        <h2 className="text-sm font-medium">Draft a reply</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a message, describe your reply, then review the draft. Nothing is sent.
        </p>
      </div>
      <fieldset disabled={pending} className="grid gap-4 border-0 p-0">
        <label className="grid gap-2 text-sm">
          <span>Message or conversation</span>
          <Textarea
            size="lg"
            value={form.conversation}
            onChange={(event) =>
              setForm((current) => ({ ...current, conversation: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span>What would you like to say?</span>
          <Input
            placeholder="For example: politely ask for more time"
            value={form.intent}
            onChange={(event) => setForm((current) => ({ ...current, intent: event.target.value }))}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span>Draft model</span>
          <select
            value={chosen?.key ?? ""}
            onChange={(event) => {
              const choice = choices.find((choice) => choice.key === event.target.value);
              if (choice) setForm((current) => ({ ...current, modelSelection: choice.selection }));
            }}
            className="rounded-lg border bg-background px-3 py-2"
          >
            <option value="" disabled>
              Choose a Claude or Codex model
            </option>
            {choices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {!choices.length ? (
          <p className="text-sm text-muted-foreground">
            Enable Claude or Codex in Settings → Providers to use isolated drafting. Other providers
            are not substituted.
          </p>
        ) : null}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Context and writing style{" "}
            {selected.length ? `(${selected.length} included)` : "(optional)"}
          </summary>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm">
              <span>Background to include</span>
              <Textarea
                value={form.background}
                onChange={(event) =>
                  setForm((current) => ({ ...current, background: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Writing examples for tone only</span>
              <Textarea
                value={form.examples}
                onChange={(event) =>
                  setForm((current) => ({ ...current, examples: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>Find saved facts or notes</span>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSearch || searching || !query.trim()}
                onClick={() => {
                  void search();
                }}
              >
                {searching ? "Searching…" : "Find context"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only checked previews are included. Check for private information before selecting
              them. Selections reset when you search again or leave this page.
            </p>
            {searched && !items.length ? (
              <p className="text-sm text-muted-foreground">No matching saved context.</p>
            ) : null}
            {items.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-lg border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>{item.title}</span>
                </label>
                {item.source ? (
                  <p className="break-all text-xs text-muted-foreground">{item.source}</p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {item.text}
                </p>
                {item.truncated ? (
                  <p className="text-xs text-muted-foreground">Only this excerpt is included.</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || !canGenerate || !chosen || !form.conversation.trim()}
          onClick={() => {
            void draft();
          }}
        >
          {pending ? "Drafting…" : "Generate draft"}
        </Button>
        {pending ? (
          <Button
            variant="outline"
            onClick={() => {
              void stop();
            }}
          >
            Stop
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Fresh session · No tools · No automatic sending
        </span>
      </div>
      {form.output ? (
        <div className="grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {pending ? "Previous unsent draft" : "Saved unsent draft"}
              </h3>
              <p className="text-xs text-muted-foreground">{form.outputModel}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(form.output, undefined)}
            >
              {isCopied ? "Copied" : "Copy draft"}
            </Button>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{form.output}</p>
        </div>
      ) : null}
    </section>
  );
}
