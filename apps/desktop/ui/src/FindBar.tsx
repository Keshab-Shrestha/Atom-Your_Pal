import { useEffect, useRef } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { countLabel, selectedMatch, type FindResults } from "./find.ts";

export interface FindBarProps {
  query: string;
  results: FindResults;
  selection: number;
  /** Changes whenever Find is asked for again, so the box takes focus again. */
  focusTick: number;
  onQuery: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}

/** Find in this chat's loaded messages (ADR-152). Enter goes to the next match, Shift+Enter to the previous, Escape closes. */
export function FindBar({ query, results, selection, focusTick, onQuery, onStep, onClose }: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);
  const match = selectedMatch(results, selection);
  const none = results.matches.length === 0;
  return (
    <div
      class="findbar"
      role="search"
      aria-label="Find in this chat"
      onKeyDown={(e) => {
        // From the box or any button in the bar. Escape also stops a running turn; here it only closes Find.
        if (e.key === "Escape" && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div class="find-row">
        <Icon name="search" size={16} />
        <input
          ref={input}
          type="text"
          class="find-input"
          placeholder="Find in loaded messages"
          aria-label="Find in this chat's loaded messages"
          value={query}
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span class="find-count muted small" role="status" aria-live="polite">{query === "" ? "" : countLabel(results, selection)}</span>
        <button type="button" class="icon-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={none} onClick={() => onStep(-1)}>
          <Icon name="up" size={16} />
        </button>
        <button type="button" class="icon-btn" aria-label="Next match" title="Next match (Enter)" disabled={none} onClick={() => onStep(1)}>
          <Icon name="down" size={16} />
        </button>
        <button type="button" class="icon-btn" aria-label="Close Find in chat" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {match ? (
        <p class="find-snippet small">
          <span class="muted">{match.user ? "You: " : "ATOM: "}</span>
          {match.before}
          <mark>{match.found}</mark>
          {match.after}
        </p>
      ) : (
        <p class="find-snippet small muted">{query !== "" ? "No match in the loaded messages." : "Searches the loaded messages only, not archived history."}</p>
      )}
    </div>
  );
}
