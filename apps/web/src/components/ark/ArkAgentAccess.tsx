import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  ArkAgentAccessInput,
  ArkAgentAccessResult,
  ArkAgentPolicy,
  EnvironmentId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const folderStates = {
  verified: "Reviewed",
  unverified: "Needs review",
  changed: "Folder changed",
  missing: "Missing",
  invalid: "Unavailable or unsafe",
};
const toolLabels: Record<string, string> = {
  "web.search": "Web search",
  "web.read": "Read web pages",
  "file.read": "Read reviewed folders",
  "file.write": "Edit reviewed folders",
};
export function ArkAgentAccess({
  environmentId,
  initial,
  onClose,
}: {
  environmentId: EnvironmentId;
  initial: ArkAgentPolicy;
  onClose: () => void;
}) {
  const [policy, setPolicy] = useState(initial);
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<ArkAgentAccessResult["preview"]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const allowed = useAtomValue(serverEnvironment.arkAgentAccess.permissionAtom(environmentId));
  const canAdd = useAtomValue(
    serverEnvironment.arkAgentAccess.permissionAtom(environmentId, {
      action: "preview",
      agent: policy.agent,
      expectedRevision: policy.revision,
      path: "",
    }),
  );
  const canRead = useAtomValue(serverEnvironment.arkReadKnowledge.permissionAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.arkAgentAccess, { reportFailure: false });
  const read = useAtomCommand(serverEnvironment.arkReadKnowledge, { reportFailure: false });
  const showFailure = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const failure = squashAtomCommandFailure(result);
    setError(
      failure instanceof Error
        ? failure.message
        : "Access could not be confirmed. Reload it before trying again.",
    );
  };
  const reload = async () => {
    setPending(true);
    setError("");
    setPreview(undefined);
    setNotice("");
    try {
      const result = await read({ environmentId, input: { kind: "agent", agent: policy.agent } });
      if (result._tag === "Success") {
        if (result.value.kind === "agent") setPolicy(result.value);
        else setError("The environment returned an invalid agent policy.");
      } else showFailure(result);
    } finally {
      setPending(false);
    }
  };
  const run = async (input: ArkAgentAccessInput) => {
    setPending(true);
    setError("");
    setNotice("");
    if (input.action !== "preview") setPreview(undefined);
    try {
      const result = await update({ environmentId, input });
      if (result._tag === "Success") {
        setPolicy(result.value.policy);
        setPreview(result.value.preview);
        if (input.action === "grant") {
          setPath("");
          setNotice(
            "Folder review saved. Task launches remain blocked until provider enforcement is connected.",
          );
        }
        if (input.action === "revoke")
          setNotice("Folder access removed from this agent. No files were deleted.");
      } else {
        setPreview(undefined);
        showFailure(result);
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{policy.name}: access</DialogTitle>
          <DialogDescription>
            Review this profile's tool kit and folders on the connected environment. Ready and Full
            access do not override these restrictions.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <section className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">
                {policy.kit === "think"
                  ? "Think"
                  : policy.kit === "folders"
                    ? "Folders"
                    : "Research"}{" "}
                tool kit
              </h3>
              <Button
                variant="outline"
                size="xs"
                disabled={pending || !canRead}
                onClick={() => {
                  void reload();
                }}
              >
                Reload access
              </Button>
            </div>
            <p className="text-muted-foreground">
              {policy.toolKinds.length
                ? policy.toolKinds.map((kind) => toolLabels[kind] ?? kind).join(" · ")
                : "No tools, file access or web access."}
            </p>
            <p className="text-xs text-muted-foreground">
              Skills guide the work; they cannot grant tools or folders. Shell commands, Git
              commits/pushes, computer control and sending messages are outside these kits.
            </p>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Folders</h3>
            {policy.folders.length ? (
              <ul className="divide-y rounded-lg border px-3">
                {policy.folders.map((folder) => (
                  <li key={folder.path} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm">{folder.path}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {folderStates[folder.state]}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {policy.kit === "folders" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={pending || !canAdd}
                          onClick={() => {
                            void run({
                              action: "preview",
                              agent: policy.agent,
                              expectedRevision: policy.revision,
                              path: folder.path,
                            });
                          }}
                        >
                          Review
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost-destructive"
                        disabled={pending || !allowed}
                        onClick={() => {
                          void run({
                            action: "revoke",
                            agent: policy.agent,
                            expectedRevision: policy.revision,
                            path: folder.path,
                          });
                        }}
                      >
                        Remove access
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No folders assigned.</p>
            )}
            {policy.kit === "folders" ? (
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!pending && canAdd && path.trim())
                    void run({
                      action: "preview",
                      agent: policy.agent,
                      expectedRevision: policy.revision,
                      path: path.trim(),
                    });
                }}
              >
                <label className="grid min-w-0 flex-1 gap-2 text-sm">
                  <span>Folder on this environment</span>
                  <Input
                    value={path}
                    onChange={(event) => {
                      setPath(event.target.value);
                      setPreview(undefined);
                    }}
                    placeholder="Full folder path"
                    disabled={pending || !canAdd}
                  />
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={pending || !canAdd || !path.trim()}
                >
                  Preview
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                This kit cannot receive folder access.
              </p>
            )}
            {preview ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p>
                  {preview.replaces
                    ? "Reconfirm this folder's current identity:"
                    : "Allow this agent to read and edit this folder when restricted launches are enabled:"}
                </p>
                <p className="break-all font-medium">{preview.path}</p>
                <p className="text-xs text-muted-foreground">
                  This is the resolved folder location. Its identity is checked again before saving.
                  The review expires after five minutes.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending || !canAdd}
                    onClick={() => {
                      void run({
                        action: "grant",
                        agent: policy.agent,
                        expectedRevision: policy.revision,
                        token: preview.token,
                      });
                    }}
                  >
                    {preview.replaces ? "Confirm folder" : "Grant folder access"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setPreview(undefined)}
                  >
                    Cancel review
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
          <section className="space-y-2 rounded-lg border p-3 text-sm">
            <h3 className="font-medium">Task launches blocked</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {policy.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </section>
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {!allowed ? (
            <p className="text-xs text-muted-foreground">
              This connection can inspect access but cannot change grants.
            </p>
          ) : null}
          {allowed && !canAdd && policy.kit === "folders" ? (
            <p className="text-xs text-muted-foreground">
              Reviewing or adding folders also requires file-read permission on this environment.
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
