import { Icon } from "./icons.tsx";
import { SECTIONS, type Section, type SectionId } from "./nav.ts";

function RailButton({ section, active, onOpen }: { section: Section; active: boolean; onOpen: (id: SectionId) => void }) {
  const label = section.ported ? section.label : `${section.label} (not in this build yet)`;
  return (
    <button
      type="button"
      class="rail-btn"
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      aria-disabled={section.ported ? undefined : "true"}
      onClick={() => section.ported && onOpen(section.id)}
    >
      <Icon name={section.icon} />
    </button>
  );
}

export function Rail({ active, onOpen }: { active: SectionId; onOpen: (id: SectionId) => void }) {
  return (
    <nav class="lane lane-rail" aria-label="Main navigation">
      {(["main", "foot"] as const).map((group) => (
        <div class="rail-group" key={group}>
          {SECTIONS.filter((s) => s.group === group).map((section) => (
            <RailButton key={section.id} section={section} active={section.id === active} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </nav>
  );
}
