import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { callCount, callWord, isWorking, settledAnswer, workLabel, type WorkLog as Log } from "./work-log.ts";

const SYMBOL = { ok: "check", error: "close", started: "sparkle", unknown: "more" } as const;

/**
 * What ATOM did during this turn, as far as the window saw it (ADR-156): elapsed time and the tools it used. It is a temporary log of
 * foreground observations, not a record of permission and not proof of what did or did not happen.
 */
export function WorkLog({ log, step }: { log: Log; step?: string }) {
  const [open, setOpen] = useState(false);
  // Time counts from the moment each snapshot arrived, so the label keeps moving between them while the work goes on.
  const arrived = useRef({ n: log.n, at: performance.now() });
  if (arrived.current.n !== log.n) arrived.current = { n: log.n, at: performance.now() };
  const [, tick] = useState(0);
  const working = isWorking(log);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const since = performance.now() - arrived.current.at;
  const settled = log.work.questions.filter((q) => q.state !== "pending");
  return (
    <section class="worklog" aria-label="Work log">
      <button type="button" class="worklog-toggle" aria-expanded={open} title="Elapsed foreground work time includes model setup, tool calls and waiting for answers; speech playback is separate" onClick={() => setOpen(!open)}>
        <span class={open ? "worklog-chev open" : "worklog-chev"}><Icon name="chevron" size={14} /></span>
        <span class="worklog-time">{workLabel(log, since)}</span>{" "}
        <span>· {callCount(log.work.calls.length)}</span>
        {working && step ? <>{" "}<span class="worklog-step">· {step}</span></> : null}
      </button>
      {open ? (
        <div class="worklog-body">
          <p class="small muted">Observed foreground tools only. Background agents have their own Board history. Missing results mean an unknown outcome; they do not prove nothing happened.</p>
          {log.work.calls.length === 0 ? <p class="small muted">No tool calls observed.</p> : null}
          <ul class="worklog-calls" aria-label="Observed calls">
            {log.work.calls.map((call) => (
              <li key={call.id} class={`worklog-call call-${call.state}`}>
                <Icon name={SYMBOL[call.state]} size={14} />
                <span class="worklog-tool">{call.tool}</span>
                <span class="small muted">{callWord(call.state)}</span>
                {call.ms !== undefined ? <span class="small muted worklog-ms">{Math.floor(call.ms / 1000)}s</span> : null}
              </li>
            ))}
          </ul>
          {log.work.omitted > 0 ? <p class="small muted">{log.work.omitted} additional call observations omitted.</p> : null}
          {settled.map((q) => (
            <div key={q.id} class="worklog-question">
              <p class="worklog-prompt">{q.prompt}</p>
              <p class="small muted">{settledAnswer(q)}</p>
            </div>
          ))}
          <p class="small muted">This work log is temporary and is not restored from saved history.</p>
        </div>
      ) : null}
    </section>
  );
}
