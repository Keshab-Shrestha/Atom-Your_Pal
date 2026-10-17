import type { LanguageModel, RequestContext } from "@atom/contracts";

/**
 * Ask ATOM (upgrades.md B3): the user selects some text, or none, and says what to do to it ("make it shorter"). One model run
 * without tools rewrites the target and the window shows the change for the user to accept or deny. The text goes to the model
 * only because the user asked. No memory, no chat and no tools go with it. The log has sizes, never the text.
 */

export const MAX_EDIT_TEXT = 100_000;
export const MAX_EDIT_INSTRUCTION = 500;
/** The text around a selection that goes along as context, on each side. */
export const EDIT_CONTEXT_CHARS = 400;

export const EDIT_INSTRUCTIONS =
  "You are ATOM's text editor. The user gives a piece of text and says what to do to it. Do exactly that to the target text and return only the new target text.";

export interface TextEditRequest {
  text: string;
  /** UTF-16 offsets into `text` (the same units as JavaScript string indexes); absent: the whole text is the target. */
  selection?: [number, number];
  instruction: string;
}

export interface EditPlan {
  target: string;
  before: string;
  after: string;
  instruction: string;
}

/** Checks the request. Throws an Error with words for the user. A selection that is empty means the whole text. */
export function planEdit(req: TextEditRequest): EditPlan {
  const instruction = req.instruction.trim();
  if (!instruction) throw new Error("Say what to do with the text.");
  if (instruction.length > MAX_EDIT_INSTRUCTION) throw new Error(`The instruction is too long (limit ${MAX_EDIT_INSTRUCTION} characters).`);
  if (!req.text.trim()) throw new Error("There is no text to change.");
  if (req.text.length > MAX_EDIT_TEXT) throw new Error(`The text is too long for ATOM to change (limit ${MAX_EDIT_TEXT} characters).`);
  const sel = req.selection;
  if (!sel || sel[0] === sel[1]) return { target: req.text, before: "", after: "", instruction };
  const [start, end] = sel;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > req.text.length || start > end) throw new Error("The selection is outside the text.");
  return {
    target: req.text.slice(start, end),
    before: req.text.slice(Math.max(0, start - EDIT_CONTEXT_CHARS), start),
    after: req.text.slice(end, end + EDIT_CONTEXT_CHARS),
    instruction,
  };
}

/** The job text for the model. The context is marked as not to be changed. */
export function editTask(plan: EditPlan): string {
  const parts = [`Instruction: ${plan.instruction}`];
  if (plan.before || plan.after) {
    parts.push(`Text just before the target (context only, do not return it):\n<<<\n${plan.before}\n>>>`);
    parts.push(`Text just after the target (context only, do not return it):\n<<<\n${plan.after}\n>>>`);
  }
  parts.push(`Target text:\n<<<\n${plan.target}\n>>>`);
  return parts.join("\n\n");
}

/** A model reply sometimes wraps the text in a Markdown fence; the text is what is inside. */
export function cleanEditReply(reply: string): string {
  const m = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(reply);
  return m ? m[1]! : reply;
}

export interface TextEditResult {
  /** The new target text: the replacement for the selection, or for the whole text. */
  answer: string;
  /** False when the answer is the target as it was. */
  changed: boolean;
}

export interface TextEditor {
  edit(req: TextEditRequest, signal: AbortSignal): Promise<TextEditResult>;
}

/** Text-only editing follows the active chat's choice, with no fallback to another subscription. */
export function providerTextWriter(options: {
  choice(): { provider: string; model: string };
  claude(task: string, signal: AbortSignal): Promise<string>;
  other(choice: { provider: string; model: string }): LanguageModel;
  context(): RequestContext;
}) {
  return async (task: string, signal: AbortSignal): Promise<string> => {
    const choice = options.choice();
    if (choice.provider === "claude-plan") return options.claude(task, signal);
    const model = options.other(choice);
    try {
      const reply = await model.complete({ system: EDIT_INSTRUCTIONS, messages: [{ role: "user", content: task }], context: options.context() }, signal);
      return reply.text;
    } finally { model.close?.(); }
  };
}

export function createTextEditor(options: {
  /** The model run: the new target text. Rejects when the model is not available. */
  write(task: string, signal: AbortSignal): Promise<string>;
  log?: { info(event: string, fields: Record<string, unknown>): void };
}): TextEditor {
  return {
    async edit(req, signal) {
      const plan = planEdit(req);
      const answer = cleanEditReply(await options.write(editTask(plan), signal));
      const changed = answer !== plan.target;
      options.log?.info("text.edit", { chars: plan.target.length, selected: Boolean(req.selection && req.selection[0] !== req.selection[1]), changed });
      return { answer, changed };
    },
  };
}
