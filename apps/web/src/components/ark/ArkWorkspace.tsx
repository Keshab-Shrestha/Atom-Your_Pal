import { ArkAgentAccess } from "./ArkAgentAccess";
import { ArkComputerSettings } from "./ArkComputer";
import { ArkReplyDraft } from "./ArkReplyDraft";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ArkSources } from "./ArkSources";
import { Link } from "@tanstack/react-router";
import { ArkAgentEditor, ArkAgentSkillsEditor, ArkNoteEditor, type ArkEditor } from "./ArkEditors";
import { useAtomValue } from "@effect/atom-react";
import { type ArkFeatureSnapshot } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { useState, type ReactNode } from "react";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SidebarInset } from "../ui/sidebar";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

const featuresAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  return environmentId
    ? get(serverEnvironment.arkFeatures({ environmentId, input: {} }))
    : AsyncResult.initial<ArkFeatureSnapshot>();
}).pipe(Atom.withLabel("ark-workspace-features"));

const pages = [
  "Overview",
  "Board",
  "Memory",
  "Sources",
  "Skills",
  "Briefs",
  "Draft a reply",
  "Computer",
] as const;
type Page = (typeof pages)[number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-border/60 bg-card/40 p-5">
      <h2 className="mb-4 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}

export function ArkWorkspace() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return <ArkWorkspaceContent key={environmentId ?? "disconnected"} />;
}

function ArkWorkspaceContent() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const canInspectAgents = useAtomValue(
    serverEnvironment.arkReadKnowledge.permissionAtom(environmentId),
  );
  const [loadingAgentPolicy, setLoadingAgentPolicy] = useState<string | null>(null);
  const canManageAgents = useAtomValue(
    serverEnvironment.arkSetAgentPaused.permissionAtom(environmentId),
  );
  const canEdit = useAtomValue(serverEnvironment.arkMutate.permissionAtom(environmentId));
  const mutateKnowledge = useAtomCommand(serverEnvironment.arkReadKnowledge);
  const [editor, setEditor] = useState<ArkEditor | null>(null);
  const [loadingNote, setLoadingNote] = useState<number | null>(null);
  const setAgentPaused = useAtomCommand(serverEnvironment.arkSetAgentPaused);
  const result = useAtomValue(featuresAtom);
  const data = Option.getOrNull(AsyncResult.value(result));
  const [page, setPage] = useState<Page>("Overview");
  const threads = useThreadShells(page === "Overview" || page === "Board");
  const currentWork = threads.filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.archivedAt === null &&
      (threadRuntimeIsActive(thread.runtime) ||
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput ||
        thread.pendingBackgroundTasks.length > 0),
  );
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const jobs =
    data?.agents.flatMap((agent) => agent.jobs.map((job) => ({ ...job, agent: agent.name }))) ?? [];
  const readyAgents = data?.agents.filter((agent) => agent.available && !agent.paused).length ?? 0;
  return (
    <SidebarInset className="h-dvh">
      <header className="flex min-h-[var(--workspace-topbar-height)] shrink-0 items-center border-b px-6">
        <div>
          <h1 className="text-sm font-medium">ARK workspace</h1>
          <p className="text-xs text-muted-foreground">Your agents, knowledge and daily work</p>
        </div>
      </header>
      <nav
        aria-label="Workspace sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-5 py-2"
      >
        {pages.map((item) => (
          <Button
            key={item}
            variant={page === item ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPage(item)}
            aria-pressed={page === item}
          >
            {item}
          </Button>
        ))}
      </nav>
      <ScrollArea>
        <div className="space-y-5 p-6">
          <div
            className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
            role="status"
          >
            <span>
              {data?.message ??
                (result._tag === "Failure"
                  ? "ARK features could not connect to this environment."
                  : "Connecting to ARK features…")}
            </span>
            {data ? <Badge variant="secondary">{data.status}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Manage agent availability and view remembered facts, notes and saved briefs. Chat can
            retrieve knowledge and skills as needed. More native features are being connected.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link to="/" className="text-muted-foreground underline underline-offset-4">
              Open chat and tasks
            </Link>
            <Link
              to="/settings/scheduled-tasks"
              className="text-muted-foreground underline underline-offset-4"
            >
              Manage schedules
            </Link>
          </div>
          {data?.status === "ready" && canEdit && (page === "Board" || page === "Memory") ? (
            <div>
              <Button
                onClick={() => setEditor(page === "Board" ? { kind: "agent" } : { kind: "note" })}
              >
                {page === "Board" ? "Add agent" : "New note"}
              </Button>
            </div>
          ) : null}
          {page === "Computer" && environmentId ? (
            <ArkComputerSettings environmentId={environmentId} />
          ) : null}
          {page === "Draft a reply" && environmentId ? (
            <ArkReplyDraft environmentId={environmentId} />
          ) : null}
          {data?.status === "ready" ? (
            <>
              {page === "Overview" || page === "Board" ? (
                <Section title="Chat-linked work">
                  {currentWork.length ? (
                    <ul className="divide-y">
                      {currentWork.slice(0, 20).map((thread) => (
                        <li
                          key={thread.id}
                          className="flex items-center justify-between gap-4 py-3"
                        >
                          <div className="min-w-0">
                            <Link
                              to="/$environmentId/$threadId"
                              params={buildThreadRouteParams(
                                scopeThreadRef(thread.environmentId, thread.id),
                              )}
                              className="text-sm font-medium underline underline-offset-4"
                            >
                              {thread.title}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {thread.hasPendingApprovals
                                ? "Needs approval"
                                : thread.hasPendingUserInput
                                  ? "Needs your response"
                                  : (thread.runtime?.status ??
                                    thread.latestRun?.status ??
                                    "Waiting")}
                              {thread.pendingBackgroundTasks.length
                                ? ` · ${thread.pendingBackgroundTasks.length} background tasks`
                                : ""}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {thread.delegatedFrom ? "Delegated task" : "Chat"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No active chat-linked work. Start a task from chat.</Empty>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Open a conversation to review its actions, answer approvals or stop its
                    workflow.
                  </p>
                </Section>
              ) : null}
              {page === "Overview" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ["Agents", data.agents.length],
                      ["Ready agents", readyAgents],
                      ["Memories", data.memories.length],
                      ["Skills", data.skills.length],
                    ].map(([label, count]) => (
                      <Section key={label} title={String(label)}>
                        <p className="text-3xl font-semibold tabular-nums">{count}</p>
                      </Section>
                    ))}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Section title="Earlier ATOM tasks">
                      {jobs.length ? (
                        <ul className="divide-y">
                          {jobs.map((job) => (
                            <li
                              key={`${job.agent}-${job.id}`}
                              className="flex items-start justify-between gap-4 py-3"
                            >
                              <div>
                                <p className="text-sm">{job.title}</p>
                                <p className="text-xs text-muted-foreground">{job.agent}</p>
                              </div>
                              <Badge variant="secondary">{job.state}</Badge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Empty>No earlier ATOM tasks in this workspace.</Empty>
                      )}
                    </Section>
                    <Section title="Knowledge">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-2xl font-medium tabular-nums">{data.notes.length}</p>
                          <p className="text-xs text-muted-foreground">Notes</p>
                        </div>
                        <div>
                          <p className="text-2xl font-medium tabular-nums">{data.briefs.length}</p>
                          <p className="text-xs text-muted-foreground">Saved briefs</p>
                        </div>
                      </div>
                      <p className="mt-5 text-xs text-muted-foreground">
                        Existing installed ATOM data has not been imported into this development
                        workspace.
                      </p>
                    </Section>
                  </div>
                </>
              ) : null}
              {page === "Board" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.agents.map((agent) => (
                    <Section key={agent.id} title={agent.name}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">{agent.role}</p>
                        <Badge variant="secondary">
                          {agent.paused ? "Paused" : agent.available ? "Ready" : "Unavailable"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            !canInspectAgents || !environmentId || loadingAgentPolicy !== null
                          }
                          onClick={async () => {
                            if (!environmentId) return;
                            setLoadingAgentPolicy(agent.id);
                            try {
                              const result = await mutateKnowledge({
                                environmentId,
                                input: { kind: "agent", agent: agent.id },
                              });
                              if (result._tag === "Success" && result.value.kind === "agent")
                                setEditor({ kind: "access", policy: result.value });
                            } finally {
                              setLoadingAgentPolicy(null);
                            }
                          }}
                        >
                          {loadingAgentPolicy === agent.id ? "Loading access…" : "Access"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canEdit}
                          onClick={() => setEditor({ kind: "agent", agent })}
                        >
                          Edit profile
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canEdit}
                          onClick={() => setEditor({ kind: "skills", agent })}
                        >
                          Skills ({agent.skills.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canManageAgents || !environmentId || pendingAgent !== null}
                          onClick={async () => {
                            if (!environmentId) return;
                            setPendingAgent(agent.id);
                            try {
                              await setAgentPaused({
                                environmentId,
                                input: { agent: agent.id, paused: !agent.paused },
                              });
                            } finally {
                              setPendingAgent(null);
                            }
                          }}
                        >
                          {pendingAgent === agent.id
                            ? "Saving…"
                            : agent.paused
                              ? "Resume agent"
                              : "Pause agent"}
                        </Button>
                      </div>
                      <ul className="mt-4 divide-y">
                        {agent.jobs.map((job) => (
                          <li key={job.id} className="py-3">
                            <p className="text-sm">{job.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{job.state}</p>
                          </li>
                        ))}
                      </ul>
                      {agent.jobs.length === 0 ? <Empty>No recent tasks.</Empty> : null}
                    </Section>
                  ))}
                  {data.agents.length === 0 ? <Empty>No agents in this workspace.</Empty> : null}
                </div>
              ) : null}
              {page === "Memory" ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <Section title="Remembered facts">
                    {data.memories.length ? (
                      <ul className="divide-y">
                        {data.memories.map((memory) => (
                          <li key={memory.id} className="whitespace-pre-wrap py-3 text-sm">
                            {memory.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>No saved memories in this workspace.</Empty>
                    )}
                  </Section>
                  <Section title="Notes">
                    {data.notes.length ? (
                      <ul className="divide-y">
                        {data.notes.map((note) => (
                          <li key={note.id} className="py-3 text-sm">
                            <Button
                              variant="ghost"
                              disabled={loadingNote !== null}
                              onClick={async () => {
                                if (!environmentId) return;
                                setLoadingNote(note.id);
                                try {
                                  const result = await mutateKnowledge({
                                    environmentId,
                                    input: { kind: "note", id: note.id },
                                  });
                                  if (result._tag === "Success" && result.value.kind === "note")
                                    setEditor({ kind: "note", note: result.value });
                                } finally {
                                  setLoadingNote(null);
                                }
                              }}
                            >
                              {loadingNote === note.id ? "Opening…" : note.title}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>No notes in this workspace.</Empty>
                    )}
                  </Section>
                </div>
              ) : null}
              {page === "Sources" && environmentId ? (
                <ArkSources environmentId={environmentId} />
              ) : null}
              {page === "Skills" ? (
                <Section title={`${data.skills.length} skills in the library`}>
                  {data.skills.length ? (
                    <ul className="divide-y">
                      {data.skills.map((skill) => (
                        <li
                          key={`${skill.source}:${skill.name}`}
                          className="flex items-start justify-between gap-5 py-3"
                        >
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium">{skill.name}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {skill.description}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {skill.source === "zeno"
                              ? "ARK"
                              : skill.source === "yours"
                                ? "Personal"
                                : skill.source || "External"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No skills have been reported by this backend.</Empty>
                  )}
                </Section>
              ) : null}
              {page === "Briefs" ? (
                <Section title="Saved briefs">
                  {data.briefs.length ? (
                    <div className="space-y-6">
                      {data.briefs.map((brief) => (
                        <article key={brief.id}>
                          <h3 className="text-sm font-medium">{brief.day}</h3>
                          <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-muted-foreground">
                            {[...new Set(brief.lines)].map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty>No saved briefs in this workspace.</Empty>
                  )}
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      </ScrollArea>
      {editor && environmentId ? (
        editor.kind === "access" ? (
          <ArkAgentAccess
            environmentId={environmentId}
            initial={editor.policy}
            onClose={() => setEditor(null)}
          />
        ) : editor.kind === "agent" ? (
          <ArkAgentEditor
            environmentId={environmentId}
            {...(editor.agent ? { agent: editor.agent } : {})}
            onClose={() => setEditor(null)}
          />
        ) : editor.kind === "skills" ? (
          <ArkAgentSkillsEditor
            environmentId={environmentId}
            agent={editor.agent}
            skills={data?.skills ?? []}
            onClose={() => setEditor(null)}
          />
        ) : (
          <ArkNoteEditor
            environmentId={environmentId}
            {...(editor.note ? { note: editor.note } : {})}
            onClose={() => setEditor(null)}
          />
        )
      ) : null}
    </SidebarInset>
  );
}
