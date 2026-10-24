// The sections of the window. `ported` is true once the section works in this window; the rest are shown, but cannot be opened, so
// nobody has to guess what is missing (docs/cross-platform-migration.md lists the Swift view each one replaces).

import type { IconName } from "./icons.tsx";

export type SectionId = "dashboard" | "chats" | "projects" | "board" | "brain" | "scheduled" | "pal" | "settings";

export interface Section {
  id: SectionId;
  label: string;
  icon: IconName;
  ported: boolean;
  /** Which group of the rail it sits in. */
  group: "main" | "foot";
}

export const SECTIONS: Section[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", ported: false, group: "main" },
  { id: "chats", label: "Chats", icon: "chats", ported: true, group: "main" },
  { id: "projects", label: "Projects", icon: "projects", ported: false, group: "main" },
  { id: "board", label: "Board", icon: "board", ported: false, group: "main" },
  { id: "brain", label: "Brain", icon: "brain", ported: false, group: "main" },
  { id: "scheduled", label: "Scheduled", icon: "scheduled", ported: false, group: "main" },
  { id: "pal", label: "Pal", icon: "pal", ported: false, group: "main" },
  { id: "settings", label: "Settings", icon: "settings", ported: false, group: "foot" },
];
