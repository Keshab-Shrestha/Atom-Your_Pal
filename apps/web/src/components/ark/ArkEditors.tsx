import { useAtomValue } from "@effect/atom-react";
import type {
  ArkAgentPolicy,
  ArkFeatureSnapshot,
  ArkKnowledgeResult,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useState, type ReactNode } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Agent = ArkFeatureSnapshot["agents"][number];
type Note = Extract<ArkKnowledgeResult, { kind: "note" }>;
export type ArkEditor =
  | { kind: "access"; policy: ArkAgentPolicy }
  | { kind: "agent"; agent?: Agent }
  | { kind: "skills"; agent: Agent }
  | { kind: "note"; note?: Note };

function failure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Success") return "";
  const error = squashAtomCommandFailure(result);
  return error instanceof Error
    ? error.message
    : "The change could not be saved. Reopen the editor to check its current state.";
}
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{title}</span>
      {children}
    </label>
  );
}
function EditorShell({
  title,
  description,
  pending,
  error,
  allowed,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  pending: boolean;
  error: string;
  allowed: boolean;
  onClose(): void;
  onSubmit(): void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (allowed && !pending) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <fieldset disabled={pending || !allowed} className="grid gap-5 border-0 p-0">
              {children}
            </fieldset>
            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {!allowed ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">
                This connection can view this content but cannot edit it.
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !allowed}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function ArkAgentEditor({
  agent,
  environmentId,
  onClose,
}: {
  agent?: Agent;
  environmentId: EnvironmentId;
  onClose(): void;
}) {
  const allowed = useAtomValue(serverEnvironment.arkMutate.permissionAtom(environmentId));
  const mutate = useAtomCommand(serverEnvironment.arkMutate, { reportFailure: false });
  const [name, setName] = useState(agent?.soul.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [kit, setKit] = useState<Agent["kit"]>(agent?.kit ?? "think");
  const [personality, setPersonality] = useState(agent?.soul.personality ?? "");
  const [howItWorks, setHowItWorks] = useState(agent?.soul.howItWorks ?? "");
  const [rules, setRules] = useState(agent?.soul.rules ?? "");
  const [lessons, setLessons] = useState(agent?.soul.lessons ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const result = await mutate({
        environmentId,
        input: agent
          ? {
              kind: "agent.soul",
              agent: agent.id,
              expectedVersion: agent.soulVersion,
              soul: { name, personality, howItWorks, rules, lessons },
            }
          : { kind: "agent.create", name, role, kit, personality, howItWorks, rules },
      });
      if (result._tag === "Success") onClose();
      else setError(failure(result));
    } finally {
      setPending(false);
    }
  };
  return (
    <EditorShell
      title={agent ? `Edit ${agent.name}` : "Add agent"}
      description={
        agent
          ? "Changes are saved as a new profile version. Existing access grants stay under permission controls."
          : "Create an agent profile. Its tool kit is fixed at creation; access is granted separately."
      }
      pending={pending}
      error={error}
      allowed={allowed}
      onClose={onClose}
      onSubmit={() => {
        void save();
      }}
    >
      <Field title="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} required />
      </Field>
      {!agent ? (
        <>
          <Field title="Role">
            <Input value={role} onChange={(event) => setRole(event.target.value)} required />
          </Field>
          <Field title="Tool kit">
            <select
              value={kit}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "think" || value === "research" || value === "folders") setKit(value);
              }}
              className="rounded-lg border bg-background px-3 py-2"
            >
              <option value="think">Thinking</option>
              <option value="research">Research</option>
              <option value="folders">Files and folders</option>
            </select>
          </Field>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {agent.role} · {agent.kit} kit · Profile version {agent.soulVersion}
        </p>
      )}
      <Field title="Personality">
        <Textarea
          value={personality}
          onChange={(event) => setPersonality(event.target.value)}
          required
        />
      </Field>
      <Field title="How it works">
        <Textarea value={howItWorks} onChange={(event) => setHowItWorks(event.target.value)} />
      </Field>
      <Field title="Rules">
        <Textarea value={rules} onChange={(event) => setRules(event.target.value)} />
      </Field>
      {agent ? (
        <Field title="Lessons">
          <Textarea value={lessons} onChange={(event) => setLessons(event.target.value)} />
        </Field>
      ) : null}
    </EditorShell>
  );
}

export function ArkAgentSkillsEditor({
  agent,
  skills,
  environmentId,
  onClose,
}: {
  agent: Agent;
  skills: ArkFeatureSnapshot["skills"];
  environmentId: EnvironmentId;
  onClose(): void;
}) {
  const allowed = useAtomValue(serverEnvironment.arkMutate.permissionAtom(environmentId));
  const mutate = useAtomCommand(serverEnvironment.arkMutate, { reportFailure: false });
  const [selected, setSelected] = useState([...agent.skills]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const names = [...new Set([...skills.map((skill) => skill.name), ...agent.skills])];
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const result = await mutate({
        environmentId,
        input: { kind: "agent.skills", agent: agent.id, expected: agent.skills, skills: selected },
      });
      if (result._tag === "Success") onClose();
      else setError(failure(result));
    } finally {
      setPending(false);
    }
  };
  return (
    <EditorShell
      title={`Skills for ${agent.name}`}
      description="Select the skills attached to this agent's profile. Skills provide guidance and cannot grant access."
      pending={pending}
      error={error}
      allowed={allowed}
      onClose={onClose}
      onSubmit={() => {
        void save();
      }}
    >
      <Field title="Search skills">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
      <div className="grid gap-3">
        {names
          .filter((name) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((name) => (
            <label key={name} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, name]
                      : current.filter((item) => item !== name),
                  )
                }
              />
              <span>{name}</span>
            </label>
          ))}
      </div>
    </EditorShell>
  );
}

export function ArkNoteEditor({
  note,
  environmentId,
  onClose,
}: {
  note?: Note;
  environmentId: EnvironmentId;
  onClose(): void;
}) {
  const allowed = useAtomValue(serverEnvironment.arkMutate.permissionAtom(environmentId));
  const mutate = useAtomCommand(serverEnvironment.arkMutate, { reportFailure: false });
  const source = useAtomCommand(serverEnvironment.arkSource, { reportFailure: false });
  const canRestore = useAtomValue(serverEnvironment.arkSource.permissionAtom(environmentId));
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const result = await mutate({
        environmentId,
        input: {
          kind: "note.save",
          ...(note ? { id: note.id, expectedRevision: note.revision } : {}),
          title,
          body,
        },
      });
      if (result._tag === "Success") onClose();
      else setError(failure(result));
    } finally {
      setPending(false);
    }
  };
  const restore = async () => {
    if (!note || !canRestore) return;
    setPending(true);
    setError("");
    try {
      const result = await source({ environmentId, input: { action: "restore", id: note.id } });
      if (result._tag === "Failure") setError(failure(result));
      else if (result.value.error) setError(result.value.error);
      else onClose();
    } finally {
      setPending(false);
    }
  };
  return (
    <EditorShell
      title={note ? "Edit note" : "New note"}
      description={
        note?.source
          ? "This note has an imported source. Your edits are saved locally; the source file is kept."
          : "Save reference material for ARK to retrieve during chat."
      }
      pending={pending}
      error={error}
      allowed={allowed}
      onClose={onClose}
      onSubmit={() => {
        void save();
      }}
    >
      {note?.source ? (
        <div className="grid gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
          <p className="break-all">Source: {note.source.relativePath}</p>
          <p>
            {note.source.state === "conflict"
              ? "The original file and local copy both changed. Refreshing keeps your edits."
              : note.source.state === "corrected"
                ? "This copy contains local edits."
                : note.source.state === "missing"
                  ? "The original file was missing at the last refresh. This copy is kept."
                  : "This copy matches the last imported version."}
          </p>
          {note.source.state === "corrected" || note.source.state === "conflict" ? (
            confirmRestore ? (
              <>
                <p role="alert">
                  Use the current file version and discard local corrections and unsaved edits to
                  this note?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRestore(false)}
                  >
                    Keep my edits
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canRestore || pending}
                    onClick={() => {
                      void restore();
                    }}
                  >
                    Replace local copy
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canRestore || pending}
                  onClick={() => setConfirmRestore(true)}
                >
                  Use file version…
                </Button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
      <Field title="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
      </Field>
      <Field title="Note">
        <Textarea size="lg" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
    </EditorShell>
  );
}
