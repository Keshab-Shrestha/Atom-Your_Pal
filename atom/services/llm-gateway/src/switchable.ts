import type { LanguageModel } from "@atom/contracts";

export interface SwitchableModel extends LanguageModel {
  /** Uses `next` for every request from now on. A request already in flight finishes on the old model. */
  replace(next: LanguageModel): void;
}

/**
 * A language model whose underlying gateway can be swapped at run time (e.g. ATOM Island's model
 * setting, ADR-038). The Core keeps one model, and with it the conversation, across a switch.
 */
export function createSwitchableModel(initial: LanguageModel): SwitchableModel {
  let current = initial;
  return {
    complete(request, signal) {
      return current.complete(request, signal);
    },
    prepare(request) {
      current.prepare?.(request);
    },
    close() {
      current.close?.();
    },
    replace(next) {
      current.close?.(); // a pre-started process for the old model is no use now
      current = next;
    },
  };
}
