import { Icon, type IconName } from "./icons.tsx";

const SURFACES: { id: string; title: string; text: string; icon: IconName }[] = [
  { id: "files", title: "Files", text: "Browse and preview the project folder.", icon: "files" },
  { id: "changes", title: "Changes", text: "Tracked task edits with compare and Undo.", icon: "changes" },
  { id: "git", title: "Git", text: "Local repository status and diffs.", icon: "git" },
  { id: "browser", title: "Browser", text: "A site or local dev server beside the chat.", icon: "browser" },
  { id: "terminal", title: "Terminal", text: "Your own shell in the project folder.", icon: "terminal" },
];

/** The fourth lane. Nothing here works yet in this window: each surface is its own port step, so the cards say so instead of doing nothing. */
export function Surface() {
  return (
    <section class="lane lane-surface" aria-label="Workspace">
      <header>
        <p class="eyebrow">Workspace</p>
        <h2 class="display">Choose a surface</h2>
      </header>
      <ul class="surfaces">
        {SURFACES.map((surface) => (
          <li key={surface.id}>
            <button type="button" class="surface-card" aria-disabled="true" aria-describedby={`${surface.id}-note`}>
              <span class="surface-icon"><Icon name={surface.icon} /></span>
              <span class="surface-title">{surface.title}</span>
              <span class="muted small">{surface.text}</span>
              <span id={`${surface.id}-note`} class="tag">Not in this build yet</span>
            </button>
          </li>
        ))}
      </ul>
      <p class="muted small">These surfaces need an open project. They arrive one at a time; the Mac app still has them today.</p>
    </section>
  );
}
