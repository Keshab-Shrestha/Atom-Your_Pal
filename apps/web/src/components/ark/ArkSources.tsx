import { useAtomValue } from "@effect/atom-react";
import type { ArkSourceRequest, ArkSourceResult, EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function ArkSources({ environmentId }: { environmentId: EnvironmentId }) {
  const allowed = useAtomValue(serverEnvironment.arkSource.permissionAtom(environmentId));
  const initial = useAtomValue(serverEnvironment.arkSourceState({ environmentId, input: {} }));
  const source = useAtomCommand(serverEnvironment.arkSource, { reportFailure: false });
  const [view, setView] = useState<ArkSourceResult | null>(null);
  const current = view ?? Option.getOrNull(AsyncResult.value(initial));
  const [path, setPath] = useState("");
  const [documents, setDocuments] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const run = async (input: ArkSourceRequest) => {
    setPending(true);
    setError("");
    try {
      const result = await source({ environmentId, input });
      if (result._tag === "Success") {
        setView(result.value);
        setError(result.value.error ?? "");
        if (!result.value.error) setConfirmDisconnect(false);
      } else {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error
            ? failure.message
            : "The source operation failed. Refresh its status before retrying.",
        );
      }
    } finally {
      setPending(false);
    }
  };
  const folder = current?.state.folder;
  const preview = current?.preview;
  return (
    <section className="grid gap-5 rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Knowledge sources</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !allowed}
          onClick={() => {
            void run({ action: "get" });
          }}
        >
          Refresh status
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Connect a folder on this environment to import Markdown, text and optionally PDF or Word
        documents. Source files are read only. Imported notes become searchable from chat.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {initial._tag === "Failure" && !current ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Source status could not load. Check this connection's file-read and workspace permissions,
          then refresh.
        </p>
      ) : null}
      {!current && initial._tag !== "Failure" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading source status…
        </p>
      ) : null}
      {folder ? (
        <>
          <div className="grid gap-2 text-sm">
            <p className="break-all font-medium">{folder.path}</p>
            <p className="text-muted-foreground">
              {current.state.notes} imported · {current.state.corrected} edited locally ·{" "}
              {current.state.conflicts} conflicts · {current.state.missing} missing ·{" "}
              {folder.skipped} skipped
            </p>
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(folder.checkedAt).toLocaleString()}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Refreshing preserves local edits and reports conflicts when the source also changed.
            Disconnecting removes the imported notes, including local corrections.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || !allowed}
              onClick={() => {
                void run({ action: "refresh" });
              }}
            >
              {pending ? "Working…" : "Refresh from folder"}
            </Button>
            <Button
              variant="outline"
              disabled={pending || !allowed}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect folder…
            </Button>
          </div>
        </>
      ) : current ? (
        <>
          <fieldset
            disabled={pending || !allowed || Boolean(preview)}
            className="grid gap-4 border-0 p-0"
          >
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Folder path on this environment</span>
              <Input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/Documents/Notes"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={documents}
                onChange={(event) => setDocuments(event.target.checked)}
              />
              Include PDF and Word (.docx) documents
            </label>
          </fieldset>
          {preview ? (
            <div className="grid gap-3 rounded-lg border p-4">
              <p className="text-sm font-medium">
                {preview.count} notes ready to import · {preview.skipped} skipped
              </p>
              <p className="break-all text-xs text-muted-foreground">{preview.path}</p>
              <ul className="grid gap-1 text-sm">
                {preview.files.map((file) => (
                  <li key={file} className="break-all">
                    {file}
                  </li>
                ))}
              </ul>
              {preview.count > preview.files.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {preview.files.length} files.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={pending || !allowed}
                  onClick={() => {
                    void run({ action: "connect", token: preview.token });
                  }}
                >
                  {pending ? "Importing…" : "Import these notes"}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending || !allowed}
                  onClick={() => {
                    void run({ action: "cancel" });
                  }}
                >
                  Cancel preview
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                disabled={pending || !allowed || !path.trim()}
                onClick={() => {
                  void run({ action: "preview", path: path.trim(), documents });
                }}
              >
                {pending ? "Scanning…" : "Preview folder"}
              </Button>
            </div>
          )}
        </>
      ) : null}
      <Dialog
        open={confirmDisconnect}
        onOpenChange={(open) => {
          if (!pending) setConfirmDisconnect(open);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Disconnect this source?</DialogTitle>
            <DialogDescription>
              This removes the folder connection and its {current?.state.notes ?? 0} imported notes,
              including {current?.state.corrected ?? 0} locally edited notes and any corrections in
              conflict. Original files are kept. Other notes are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDisconnect(false)}
            >
              Keep connected
            </Button>
            <Button
              disabled={pending || !allowed}
              onClick={() => {
                void run({ action: "disconnect" });
              }}
            >
              {pending ? "Disconnecting…" : "Remove imported notes"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
