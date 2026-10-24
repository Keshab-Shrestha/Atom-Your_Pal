// What is waiting to be said, per chat: the unsent draft, the live queue and the held messages. Pure. A port of the rules in
// docs/chat-input-recovery.md (ADR-141/142): the live queue is FIFO and sends one entry at a time; after Stop, a turn-ending error, leaving the
// chat or a restart, every remaining entry is HELD for review and is never sent automatically; limits are 20 entries per chat.
// Files stay in memory (a File cannot be saved); after a restart the words come back and the count of lost files is kept.

export const MAX_ENTRIES = 20;
export const MAX_TEXT_BYTES = 128 * 1024;
export const MAX_CHATS = 100;

export interface Entry {
  id: string;
  text: string;
  files: File[];
  /** Files that did not survive a restart: the words came back, these did not. */
  lost: number;
}

export interface ChatInput {
  draft: string;
  /** Files chosen for the draft. */
  files: File[];
  /** Waiting to be sent, oldest first, as soon as the chat is idle. */
  queue: Entry[];
  /** Waiting for the user's review. Never sent automatically. */
  held: Entry[];
  /** The id of the queued entry whose turn has been asked for but has not started yet. Only one at a time. */
  sending?: string;
}

export type Inputs = Record<string, ChatInput>;

export const emptyInput = (): ChatInput => ({ draft: "", files: [], queue: [], held: [] });
const get = (inputs: Inputs, chat: string) => inputs[chat] ?? emptyInput();
const put = (inputs: Inputs, chat: string, next: ChatInput): Inputs => {
  const keep = next.draft !== "" || next.files.length > 0 || next.queue.length > 0 || next.held.length > 0;
  if (!keep) {
    const { [chat]: _gone, ...rest } = inputs;
    return rest;
  }
  return { ...inputs, [chat]: next };
};

export const textBytes = (s: string) => new TextEncoder().encode(s).length;

/** The composer's current words and files, kept for when the chat is shown again. */
export function snapshot(inputs: Inputs, chat: string, draft: string, files: File[]): Inputs {
  const cur = get(inputs, chat);
  if (cur.draft === draft && cur.files === files) return inputs;
  return put(inputs, chat, { ...cur, draft, files });
}

export type EnqueueResult = { inputs: Inputs; ok: true } | { inputs: Inputs; ok: false; why: string };

/** Adds a message at the end of the live queue. A full chat keeps the incoming draft with the composer. */
export function enqueue(inputs: Inputs, chat: string, entry: Entry): EnqueueResult {
  const cur = get(inputs, chat);
  if (cur.queue.length + cur.held.length >= MAX_ENTRIES) return { inputs, ok: false, why: `A chat keeps at most ${MAX_ENTRIES} waiting messages. Send or remove one first. Your message is still in the composer.` };
  if (textBytes(entry.text) > MAX_TEXT_BYTES) return { inputs, ok: false, why: "That message is too long to keep waiting. Shorten it or attach it as a file." };
  return { inputs: put(inputs, chat, { ...cur, queue: [...cur.queue, entry] }), ok: true };
}

/** The entry to send next, or undefined when one is already being sent or none waits. */
export function nextToSend(inputs: Inputs, chat: string): Entry | undefined {
  const cur = inputs[chat];
  return cur && cur.sending === undefined ? cur.queue[0] : undefined;
}

export function markSending(inputs: Inputs, chat: string, id: string): Inputs {
  const cur = inputs[chat];
  return cur && cur.queue.some((e) => e.id === id) ? put(inputs, chat, { ...cur, sending: id }) : inputs;
}

/** Its turn started: the entry leaves the queue, and the next one may go when the chat is idle again. */
export function started(inputs: Inputs, chat: string, id: string): Inputs {
  const cur = inputs[chat];
  if (!cur) return inputs;
  const { sending: _gone, ...rest } = cur;
  return put(inputs, chat, { ...rest, queue: cur.queue.filter((e) => e.id !== id) });
}

/** Everything still live becomes held, in order, after the entries that were already held. Nothing is lost and nothing is sent. */
export function holdAll(inputs: Inputs, chat: string): Inputs {
  const cur = inputs[chat];
  if (!cur || cur.queue.length === 0) return cur?.sending === undefined ? inputs : put(inputs, chat, { ...cur, sending: undefined } as ChatInput);
  const { sending: _gone, ...rest } = cur;
  return put(inputs, chat, { ...rest, held: [...cur.held, ...cur.queue], queue: [] });
}

/** Takes an entry out of the queue or the held list (to edit it, or to remove it). */
export function take(inputs: Inputs, chat: string, id: string): { inputs: Inputs; entry?: Entry } {
  const cur = inputs[chat];
  const entry = cur?.queue.find((e) => e.id === id) ?? cur?.held.find((e) => e.id === id);
  if (!cur || !entry || cur.sending === id) return { inputs };
  const { sending: _gone, ...rest } = cur;
  return { inputs: put(inputs, chat, { ...rest, ...(cur.sending !== undefined ? { sending: cur.sending } : {}), queue: cur.queue.filter((e) => e.id !== id), held: cur.held.filter((e) => e.id !== id) }), entry };
}

/** Puts an entry back at the front of the queue (a Send now that could not be sent). */
export function putBack(inputs: Inputs, chat: string, entry: Entry): Inputs {
  const cur = get(inputs, chat);
  return put(inputs, chat, { ...cur, queue: [entry, ...cur.queue.filter((e) => e.id !== entry.id)] });
}

// ---------- saving ----------

export interface SavedChat {
  draft: string;
  held: { id: string; text: string; lost: number }[];
}
export interface SavedInput {
  version: 1;
  chats: Record<string, SavedChat>;
}

/** Only words are saved. A queued entry is saved as held, because after a restart nothing is sent by itself. */
export function toSaved(inputs: Inputs): SavedInput {
  const chats: Record<string, SavedChat> = {};
  for (const [chat, input] of Object.entries(inputs).slice(0, MAX_CHATS)) {
    const held = [...input.held, ...input.queue].slice(0, MAX_ENTRIES).map((e) => ({ id: e.id, text: e.text, lost: e.lost + e.files.length }));
    if (input.draft === "" && held.length === 0) continue;
    chats[chat] = { draft: textBytes(input.draft) <= MAX_TEXT_BYTES ? input.draft : "", held };
  }
  return { version: 1, chats };
}

/** What was saved, as held messages and drafts. The count of files the draft had is not known after a restart, so it is not claimed. */
export function fromSaved(saved: SavedInput | undefined): Inputs {
  const out: Inputs = {};
  if (!saved || saved.version !== 1) return out;
  for (const [chat, s] of Object.entries(saved.chats)) {
    out[chat] = { draft: s.draft, files: [], queue: [], held: s.held.map((h) => ({ id: h.id, text: h.text, files: [], lost: h.lost })) };
  }
  return out;
}

/** Whether the bytes saved would change. Used to skip a write when nothing words-wise changed (typing a file name, say). */
export const savedKey = (inputs: Inputs) => JSON.stringify(toSaved(inputs));

/** Ids of every message still waiting here, for asking the runtime which of them it already holds. */
export function pendingIds(inputs: Inputs): string[] {
  return Object.values(inputs).flatMap((i) => [...i.queue, ...i.held].map((e) => e.id)).slice(0, 2000);
}

/**
 * Held messages the runtime already journals are in its Recovery list; the local copy of one that carries no files is then a duplicate and goes.
 * One with files stays: its files exist only here (the journal keeps their paths, which this window cannot reopen), or it says they were lost.
 */
export function dropAcknowledged(inputs: Inputs, known: readonly string[]): Inputs {
  if (known.length === 0) return inputs;
  const ids = new Set(known.map((k) => k.toLowerCase()));
  let next = inputs;
  for (const [chat, input] of Object.entries(inputs)) {
    const kept = input.held.filter((e) => !(ids.has(e.id.toLowerCase()) && e.files.length === 0 && e.lost === 0));
    if (kept.length !== input.held.length) next = put(next, chat, { ...input, held: kept });
  }
  return next;
}
