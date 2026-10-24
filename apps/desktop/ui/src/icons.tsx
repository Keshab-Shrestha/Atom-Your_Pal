// One icon style: 24 px grid, 1.8 stroke, round caps. Decorative by default; a button that holds only an icon carries its own label.

const PATHS = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  chats: "M4 5h16v11H9l-5 4z",
  projects: "M3 6h7l2 2h9v11H3z",
  board: "M3 4h18v16H3zM9 4v16M15 4v16",
  brain: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3 0zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1",
  scheduled: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  pal: "M12 4c4.4 0 8 3.1 8 7.5S16.4 20 12 20 4 16.6 4 12 7.6 4 12 4zM9 11h.01M15 11h.01M9.5 15c1.5 1 3.5 1 5 0",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  send: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  pin: "M9 3h6l-1 6 3 3H7l3-3zM12 12v9",
  chevron: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  files: "M3 6h7l2 2h9v11H3z",
  changes: "M8 3v13a3 3 0 0 0 3 3h5M16 14l3 3-3 3M5 6l3-3 3 3",
  git: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 6",
  browser: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  terminal: "M4 5h16v14H4zM8 10l3 2-3 2M13 15h4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
