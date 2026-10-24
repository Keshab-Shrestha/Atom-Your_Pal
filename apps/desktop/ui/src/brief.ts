// The chat brief (ADR-091 and the Mac app's ChatBrief): background the user keeps for one chat. It accompanies each request in that chat.
// It is data, never a permission and never a generated summary. The runtime checks the text and the version again when it saves.

/** The same rule as the runtime's `validChatBrief`: tab and line breaks are fine; other controls, invisible direction marks and lone surrogates are not. */
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿\ud800-\udfff]/u;

export const validBrief = (text: string): boolean => !HIDDEN.test(text);

/** Why the brief cannot be opened for this chat; undefined when it can. `busy` is the reason a running turn or change gives. */
export function openWhy(chat: { messages: number; readOnly?: boolean } | undefined, busy: string | undefined): string | undefined {
  if (!chat) return "There is no saved chat yet.";
  if (chat.readOnly) return "This chat is written from another surface (Telegram or the local API). It has no brief here.";
  if (chat.messages === 0) return "This chat is not saved yet. Send a message first.";
  return busy;
}

/** Why Save does nothing right now; undefined when it can be pressed. Unchanged text is not a problem to explain, only a disabled button. */
export function saveWhy(options: { onOriginalChat: boolean; draft: string; busy: string | undefined }): string | undefined {
  if (!options.onOriginalChat) return "Return to the original chat before saving. Your draft is still here.";
  if (!validBrief(options.draft)) return "The brief has hidden control characters. Remove them to save it.";
  return options.busy;
}

/** What to say after a save that was confirmed: the user may have kept typing while it was on its way. */
export const savedNote = (draft: string, saved: string): string => (draft === saved ? "Saved for this chat." : "Saved the submitted version. Your newer draft has not been saved.");

export const NOT_CONFIRMED = "The save is not confirmed. Your draft stays here; checking cannot overwrite a newer brief.";
export const NOT_LOADED = "The saved brief did not arrive. Your draft is unchanged.";
