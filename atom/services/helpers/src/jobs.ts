// ADR-081/082: the team, their souls and the life of a job. Pure: no storage, no clock.

/** A worker's soul (ADR-082): who it is and how it works. Editable in the ATOM window, kept with versions. */
export interface Soul {
  name: string;
  personality: string;
  howItWorks: string;
  rules: string;
  lessons: string;
}

/**
 * The team (ADR-082, Task 3.3), in the window's order. `available` and `role` are code: a soul edit never changes
 * them, and the role alone decides a worker's tools and floor. Kame, Puff and Quill work in the folders Keshab grants
 * (Task 3.11; Quill without one writes up with the research tools); Tinker waits for feedback (Task 3.13).
 */
export const HELPERS = [
  {
    id: "sid",
    name: "Sid",
    available: true,
    role: "researcher",
    soul: {
      name: "Sid",
      personality: "Curious and thorough. Always cites sources.",
      howItWorks: "Searches more than once, reads several good pages, compares what they say, and prefers primary and reputable sources.",
      rules: "Say plainly when sources disagree or when something could not be confirmed.",
      lessons: "",
    },
  },
  {
    id: "kame",
    name: "Kame",
    available: true,
    role: "coder",
    soul: {
      name: "Kame",
      personality: "Steady and careful.",
      howItWorks: "Reads the code first, writes a test first, and makes small changes.",
      rules: "Never changes more than the task needs.",
      lessons: "",
    },
  },
  {
    id: "puff",
    name: "Puff",
    available: true,
    role: "designer",
    soul: {
      name: "Puff",
      personality: "Playful and visual. Explains every choice.",
      howItWorks: "Sketches options as HTML, CSS or SVG mock-ups and says why each one works.",
      rules: "Keeps to the look the project already has unless asked to change it.",
      lessons: "",
    },
  },
  {
    id: "quill",
    name: "Quill",
    available: true,
    role: "documenter",
    soul: {
      name: "Quill",
      personality: "Clear and plain.",
      howItWorks: "Writes in plain English with short sentences, one idea per sentence.",
      rules: "Never claims something the sources or the code do not show.",
      lessons: "",
    },
  },
  {
    id: "penny",
    name: "Penny",
    available: true,
    role: "financial adviser",
    soul: {
      name: "Penny",
      personality: "Cautious. Numbers first.",
      howItWorks: "Finds current figures from reputable sources, shows the numbers, and states every assumption.",
      rules: "Says how old each figure is and where it comes from.",
      lessons: "",
    },
  },
  {
    id: "hana",
    name: "Hana",
    available: true,
    role: "hr",
    soul: {
      name: "Hana",
      personality: "Warm, fair and discreet.",
      howItWorks: "Looks for current, reputable guidance and gives balanced, practical answers.",
      rules: "Notes when the answer depends on the country or the employer's own rules.",
      lessons: "",
    },
  },
  {
    id: "tinker",
    name: "Tinker",
    available: false,
    role: "improver",
    soul: {
      name: "Tinker",
      personality: "Reflective and specific.",
      howItWorks: "Reads failed and poorly rated jobs and proposes one concrete change to a worker's soul, with the reason.",
      rules: "Proposes changes only; Keshab decides.",
      lessons: "",
    },
  },
] as const satisfies readonly { id: string; name: string; available: boolean; role: string; soul: Soul }[];

/** Editable soul fields; text is preserved without per-field character caps. */
const SOUL_FIELDS = ["name", "personality", "howItWorks", "rules", "lessons"] as const;
// ADR-095: ATOM is the manager's name now; "pal" (its old name) stays taken too.
const RESERVED_NAMES = new Set(["atom", "pal", "zeno"]);

/** How each role is named in the instructions. */
const ROLE_TITLES: Readonly<Record<string, string>> = {
  researcher: "researcher",
  coder: "coder",
  designer: "designer",
  documenter: "documenter",
  "financial adviser": "financial information researcher",
  hr: "HR researcher",
  improver: "team improver",
};

/** The line every financial report ends with (ADR-082), added by code when the model left it out. */
export const FINANCIAL_NOTICE = "This is information, not professional financial advice.";

/** Rules fixed by role in code (ADR-082): a soul edit cannot remove them. */
const ROLE_RULES: Readonly<Record<string, string>> = {
  "financial adviser": [
    "You give information, not financial advice. You never act on accounts, money, payments or trading, and you never ask for account details.",
    `End the report body with this sentence: "${FINANCIAL_NOTICE}"`,
  ].join("\n"),
  hr: "Keep personal data private: never put a private person's name, health, pay or other personal details into a web search.",
};

/**
 * A soul with its complete text tidied and validated. `others` are the other workers' names: names stay unique
 * (they are how Keshab addresses a worker by voice). Throws HelperError with words for the user.
 */
export function cleanSoul(input: Soul, others: readonly string[]): Soul {
  const soul = {} as Soul;
  for (const key of SOUL_FIELDS) {
    const value = input[key];
    if (typeof value !== "string") throw new HelperError(`The soul needs "${key}" as text.`);
    soul[key] = value.trim().replace(/\r\n?/g, "\n");
  }
  soul.name = soul.name.replace(/\s+/g, " ");
  if (!/^\p{L}[\p{L} '-]*$/u.test(soul.name)) throw new HelperError("A name needs letters only (spaces, hyphens and apostrophes are fine).");
  if (RESERVED_NAMES.has(soul.name.toLowerCase())) throw new HelperError(`"${soul.name}" is taken by ATOM itself.`);
  if (others.some((n) => n.toLowerCase() === soul.name.toLowerCase())) throw new HelperError(`Another worker is already called ${soul.name}.`);
  if (!soul.personality) throw new HelperError("The personality is empty.");
  return soul;
}

const label = (key: keyof Soul) => (key === "howItWorks" ? "how it works" : key);

/** The instructions for a job: who the worker is (its soul), then the role's fixed rules. */
export function instructionsFor(soul: Soul, role: string): string {
  const parts = [
    `You are ${soul.name}, ATOM's ${ROLE_TITLES[role] ?? role}. Keshab gives you a task; you do it and write him a report.`,
    `Personality: ${soul.personality}`,
    soul.howItWorks && `How you work: ${soul.howItWorks}`,
    soul.rules && `Your rules: ${soul.rules}`,
    soul.lessons && `Lessons from earlier jobs: ${soul.lessons}`,
    "You write in clear, plain English for one person, with short paragraphs.",
    ROLE_RULES[role],
  ];
  return parts.filter(Boolean).join("\n");
}

/** A report as the role requires: a financial report always ends with FINANCIAL_NOTICE. */
export function withRoleNotice<R extends { body: string }>(role: string, report: R): R {
  if (role !== "financial adviser" || report.body.includes(FINANCIAL_NOTICE)) return report;
  return { ...report, body: `${report.body.trimEnd()}\n\n${FINANCIAL_NOTICE}` };
}

/** A worker's id: a built-in one ("sid") or an agent's folder name (ADR-088). */
export type HelperId = string;

/** ADR-088: what each built-in role may use. Custom agents name their kit in soul.md. */
export const BUILT_IN_KITS: Readonly<Record<string, "research" | "folders" | "think">> = {
  researcher: "research",
  "financial adviser": "research",
  hr: "research",
  coder: "folders",
  designer: "folders",
  documenter: "folders",
  improver: "think",
};
export type JobState = "queued" | "running" | "done" | "failed" | "stopped";

export class HelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelperError";
  }
}

const MOVES: Record<JobState, readonly JobState[]> = {
  queued: ["running", "stopped", "failed"], // failed: a task it waited for failed or was stopped (ADR-087)
  running: ["done", "failed", "stopped"],
  done: [],
  failed: [],
  stopped: [],
};

export const isFinal = (state: JobState) => MOVES[state].length === 0;

export function canMove(from: JobState, to: JobState): boolean {
  return MOVES[from].includes(to);
}

/** The state after a move. Throws HelperError for a move the job's life does not allow. */
export function move(from: JobState, to: JobState): JobState {
  if (!canMove(from, to)) throw new HelperError(`A ${from} job cannot become ${to}.`);
  return to;
}

/**
 * ADR-090: a failure a second try may fix (a time limit, Claude Code ending early or answering in the wrong shape) is
 * retried once by itself. Setup problems (no plan, no folder) and the plan's limits never are.
 */
export const MAX_AUTO_RETRIES = 1;
const RETRYABLE = /took longer than|could not run|ended without a report|in the wrong shape|took more than \d+ steps|was closed while this job ran/i;
export const isRetryable = (error: string | undefined) => Boolean(error && RETRYABLE.test(error));

/** At most this many tasks one task may wait for (ADR-087). */
export const MAX_BLOCKERS = 6;
/** Most tasks in one goal Pal hands the team (ADR-082: up to six parts). */
export const MAX_GOAL_TASKS = 6;
/** How much of an earlier report's body a later task is given. */
export const BRIEF_REPORT_CHARS = 8000;

/**
 * Whether making `id` wait for `blockers` would close a circle: some blocker already waits, directly or through
 * others, for `id`. `edges` maps each task to the tasks it waits for.
 */
export function makesCycle(edges: ReadonlyMap<number, readonly number[]>, id: number, blockers: readonly number[]): boolean {
  const seen = new Set<number>();
  const stack = [...blockers];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === id) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(edges.get(next) ?? []));
  }
  return false;
}
