import { createPortal } from "react-dom";
import { useAtomValue } from "@effect/atom-react";
import {
  type ArkComputerState,
  type ArkComputerConfig,
  type EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useState } from "react";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function ComputerSettingsForm({
  environmentId,
  state,
}: {
  environmentId: EnvironmentId;
  state: ArkComputerState;
}) {
  const allowed = useAtomValue(
    serverEnvironment.arkConfigureComputer.permissionAtom(environmentId),
  );
  const saveSettings = useAtomCommand(serverEnvironment.arkConfigureComputer, {
    reportFailure: false,
  });
  const [config, setConfig] = useState<ArkComputerConfig>(state.config);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [forgetGrants, setForgetGrants] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    setPending(true);
    setMessage("");
    try {
      const result = await saveSettings({
        environmentId,
        input: {
          config,
          ...(key ? { jevKey: key } : {}),
          ...(removeKey ? { removeKey: true } : {}),
          ...(forgetGrants ? { forgetGrants: true } : {}),
        },
      });
      if (result._tag === "Success") {
        setKey("");
        setRemoveKey(false);
        setForgetGrants(false);
        setMessage("Computer settings saved.");
      } else {
        const error = squashAtomCommandFailure(result);
        setMessage(
          error instanceof Error ? error.message : "Computer settings could not be saved.",
        );
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      id="computer-use"
      onSubmit={(event) => {
        event.preventDefault();
        if (allowed && !state.active && !pending) void save();
      }}
      className="grid gap-5 rounded-xl border border-border/60 bg-card/40 p-5"
    >
      <div>
        <h2 className="text-sm font-medium">Computer use</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your chat model plans and reviews work. Checked host actions control apps on this
          environment, including windows on connected displays. Nothing captures the screen while
          idle.
        </p>
      </div>
      <fieldset
        disabled={!allowed || pending || state.active !== null}
        className="grid gap-4 border-0 p-0"
      >
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) =>
              setConfig((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          <span>
            Enable computer use. Each chat must first ask for access; sensitive actions still ask
            separately.
          </span>
        </label>
        <label className="grid gap-2 text-sm">
          <span>Default input mode</span>
          <select
            value={config.mode}
            onChange={(event) => {
              const mode = event.target.value;
              if (mode === "background" || mode === "foreground")
                setConfig((current) => ({ ...current, mode }));
            }}
            className="rounded-lg border bg-background px-3 py-2"
          >
            <option value="background">Background: keep working in your own window</option>
            <option value="foreground">Foreground: briefly bring the target window forward</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span>Fast decisions between prepared button plans</span>
          <select
            value={config.provider}
            onChange={(event) => {
              const provider = event.target.value;
              if (provider === "off" || provider === "laya" || provider === "jev")
                setConfig((current) => ({ ...current, provider }));
            }}
            className="rounded-lg border bg-background px-3 py-2"
          >
            <option value="off">Off: use the chat model</option>
            <option value="laya">Laya: installed local model</option>
            <option value="jev">Jev: cloud</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Jev/Laya can choose only among plans already prepared and checked by the main model and
          host. They cannot grant permissions, invent actions or verify success. Uncertainty returns
          to the main model. Local models are never downloaded automatically.
        </p>
        {config.provider === "jev" ? (
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={config.backup}
              onChange={(event) =>
                setConfig((current) => ({ ...current, backup: event.target.checked }))
              }
            />
            <span>Use Laya as backup when Jev is unavailable</span>
          </label>
        ) : null}
        <div className="grid gap-3 rounded-lg border p-4">
          <label className="grid gap-2 text-sm">
            <span>Jev API key {state.hasJevKey ? "· saved" : ""}</span>
            <Input
              type="password"
              autoComplete="off"
              value={key}
              disabled={removeKey}
              placeholder={state.hasJevKey ? "Enter a replacement key" : "Enter Jev key"}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The key stays in this environment's private credential store. Selecting Jev permits
            sending bounded goal/window labels and prepared plans to its cloud service; screenshots
            and editable-field values are excluded.
          </p>
          {state.hasJevKey ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={removeKey}
                onChange={(event) => {
                  setRemoveKey(event.target.checked);
                  if (event.target.checked) {
                    setKey("");
                    setConfig((current) =>
                      current.provider === "jev" ? { ...current, provider: "off" } : current,
                    );
                  }
                }}
              />
              Remove the saved Jev key when saving
            </label>
          ) : null}
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={forgetGrants}
            onChange={(event) => setForgetGrants(event.target.checked)}
          />
          <span>
            Forget remembered computer access for all chats when saving. Each chat will ask again.
          </span>
        </label>
      </fieldset>
      {state.active ? (
        <p role="status" className="text-sm text-muted-foreground">
          Stop the active computer action before changing its settings. If Stop was not confirmed,
          restart ARK first.
        </p>
      ) : null}
      {!allowed ? (
        <p className="text-sm text-muted-foreground">
          Changing computer settings requires settings access on this environment.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!allowed || pending || state.active !== null}>
          {pending ? "Saving…" : "Save computer settings"}
        </Button>
      </div>
    </form>
  );
}

export function ArkComputerSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(serverEnvironment.arkComputer({ environmentId, input: {} }));
  const state = Option.getOrNull(AsyncResult.value(result));
  if (!state)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {result._tag === "Failure"
          ? "Computer settings could not connect to this environment."
          : "Loading computer settings…"}
      </p>
    );
  return (
    <ComputerSettingsForm
      key={`${state.config.enabled}:${state.config.mode}:${state.config.provider}:${state.config.backup}:${state.hasJevKey}`}
      state={state}
      environmentId={environmentId}
    />
  );
}

function EnvironmentComputerActivity({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const result = useAtomValue(serverEnvironment.arkComputer({ environmentId, input: {} }));
  const state = Option.getOrNull(AsyncResult.value(result));
  const allowed = useAtomValue(serverEnvironment.arkAnswerComputer.permissionAtom(environmentId));
  const stop = useAtomCommand(serverEnvironment.arkStopComputer);
  const answer = useAtomCommand(serverEnvironment.arkAnswerComputer);
  const [pending, setPending] = useState(false);
  if (!state?.active) return null;
  const active = state.active,
    approval = active.approval;
  const respond = async (approved: boolean) => {
    if (!approval) return;
    setPending(true);
    try {
      await answer({
        environmentId,
        input: { request: active.request, id: approval.id, approved },
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label={`Computer use on ${label}`}
      className="pointer-events-auto grid gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Computer · {label}</p>
          <Link
            to="/$environmentId/$threadId"
            params={buildThreadRouteParams(
              scopeThreadRef(environmentId, ThreadId.make(active.threadId)),
            )}
            className="break-words text-sm font-medium underline underline-offset-4"
          >
            {active.title}
          </Link>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || active.phase === "blocked" || active.phase === "stopping"}
          onClick={() => {
            void stop({ environmentId, input: { request: active.request } });
          }}
        >
          {active.phase === "stopping" ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <p role="status" className="text-sm">
        {state.message}
      </p>
      {approval ? (
        <>
          <p className="text-sm font-medium">{approval.summary}</p>
          <p className="text-xs text-muted-foreground">{approval.reason}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!allowed || pending}
              onClick={() => {
                void respond(false);
              }}
            >
              Decline
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || pending}
              onClick={() => {
                void respond(true);
              }}
            >
              {approval.kind === "grant" ? "Allow this chat" : "Allow once"}
            </Button>
          </div>
        </>
      ) : null}
      {result._tag === "Failure" ? (
        <p role="alert" className="text-xs text-destructive">
          Connection lost. Reconnect to check whether the action stopped.
        </p>
      ) : null}
    </section>
  );
}
export function ArkComputerActivity({ contained = false }: { contained?: boolean }) {
  const { environments } = useEnvironments();
  const content = (
    <div
      className={`pointer-events-none ${contained ? "absolute" : "fixed"} bottom-4 right-4 z-[80] grid max-h-[80dvh] w-[min(28rem,calc(100vw-2rem))] gap-3 overflow-y-auto`}
    >
      {environments.map((environment) => (
        <EnvironmentComputerActivity
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
        />
      ))}
    </div>
  );
  return contained ? content : createPortal(content, document.body);
}
