import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";

const ArkJob = Schema.Struct({ id: Schema.Number, title: Schema.String, state: Schema.String });
const ArkSoul = Schema.Struct({
  name: Schema.String,
  personality: Schema.String,
  howItWorks: Schema.String,
  rules: Schema.String,
  lessons: Schema.String,
});
const ArkAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.String,
  available: Schema.Boolean,
  paused: Schema.Boolean,
  kit: Schema.Literals(["research", "folders", "think"]),
  custom: Schema.Boolean,
  soul: ArkSoul,
  soulVersion: Schema.Number,
  skills: Schema.Array(Schema.String),
  grants: Schema.Array(Schema.String),
  jobs: Schema.Array(ArkJob),
});
const ArkMemory = Schema.Struct({ id: Schema.Number, text: Schema.String });
const ArkNote = Schema.Struct({ id: Schema.Number, title: Schema.String });
const ArkSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  source: Schema.String,
});
const ArkBrief = Schema.Struct({
  id: Schema.Number,
  day: Schema.String,
  lines: Schema.Array(Schema.String),
});

export const ArkFeatureSnapshot = Schema.Struct({
  status: Schema.Literals(["disabled", "starting", "ready", "unavailable"]),
  message: Schema.String,
  agents: Schema.Array(ArkAgent),
  memories: Schema.Array(ArkMemory),
  notes: Schema.Array(ArkNote),
  skills: Schema.Array(ArkSkill),
  briefs: Schema.Array(ArkBrief),
});
export type ArkFeatureSnapshot = typeof ArkFeatureSnapshot.Type;

export const ArkSetAgentPaused = Schema.Struct({ agent: Schema.String, paused: Schema.Boolean });
export type ArkSetAgentPaused = typeof ArkSetAgentPaused.Type;
export const ArkMutation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("agent.create"),
    name: Schema.String,
    role: Schema.String,
    kit: Schema.Literals(["research", "folders", "think"]),
    personality: Schema.String,
    howItWorks: Schema.String,
    rules: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("agent.soul"),
    agent: Schema.String,
    expectedVersion: Schema.Int,
    soul: ArkSoul,
  }),
  Schema.Struct({
    kind: Schema.Literal("agent.skills"),
    agent: Schema.String,
    expected: Schema.Array(Schema.String),
    skills: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("note.save"),
    id: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    expectedRevision: Schema.optionalKey(Schema.String),
    title: Schema.String,
    body: Schema.String,
  }),
]);
export type ArkMutation = typeof ArkMutation.Type;
export const ArkMutationResult = Schema.Struct({
  snapshot: ArkFeatureSnapshot,
  entityId: Schema.String,
});
export type ArkMutationResult = typeof ArkMutationResult.Type;
export class ArkFeatureError extends Schema.TaggedError<ArkFeatureError>()("ArkFeatureError", {
  message: Schema.String,
}) {}

const ArkAgentId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
const ArkAgentRevision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const ArkAgentFolderPath = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.isPattern(/^[^\0]*$/),
);
export const ArkAgentPolicy = Schema.Struct({
  kind: Schema.Literal("agent"),
  agent: ArkAgentId,
  name: Schema.String,
  kit: Schema.Literals(["research", "folders", "think"]),
  soulVersion: Schema.Number,
  available: Schema.Boolean,
  paused: Schema.Boolean,
  skills: Schema.Array(Schema.String),
  folders: Schema.Array(
    Schema.Struct({
      path: ArkAgentFolderPath,
      identity: Schema.String,
      state: Schema.Literals(["verified", "unverified", "changed", "missing", "invalid"]),
    }),
  ),
  toolKinds: Schema.Array(Schema.String),
  launchAllowed: Schema.Literal(false),
  blockers: Schema.Array(Schema.String),
  revision: ArkAgentRevision,
});
export type ArkAgentPolicy = typeof ArkAgentPolicy.Type;
export const ArkAgentAccessInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("preview"),
    agent: ArkAgentId,
    expectedRevision: ArkAgentRevision,
    path: ArkAgentFolderPath,
  }),
  Schema.Struct({
    action: Schema.Literal("grant"),
    agent: ArkAgentId,
    expectedRevision: ArkAgentRevision,
    token: Schema.String.check(Schema.isUUID()),
  }),
  Schema.Struct({
    action: Schema.Literal("revoke"),
    agent: ArkAgentId,
    expectedRevision: ArkAgentRevision,
    path: ArkAgentFolderPath,
  }),
]);
export type ArkAgentAccessInput = typeof ArkAgentAccessInput.Type;
export const ArkAgentAccessResult = Schema.Struct({
  policy: ArkAgentPolicy,
  preview: Schema.optionalKey(
    Schema.Struct({ token: Schema.String, path: ArkAgentFolderPath, replaces: Schema.Boolean }),
  ),
});
export type ArkAgentAccessResult = typeof ArkAgentAccessResult.Type;

export const ArkKnowledgeQuery = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("agent"), agent: ArkAgentId }),
  Schema.Struct({ kind: Schema.Literal("memory"), id: Schema.Int.check(Schema.isGreaterThan(0)) }),
  Schema.Struct({ kind: Schema.Literal("search"), query: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("note"), id: Schema.Int.check(Schema.isGreaterThan(0)) }),
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Schema.String,
    source: Schema.Literals(["ark", "personal"]),
    file: Schema.String,
    offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);
export type ArkKnowledgeQuery = typeof ArkKnowledgeQuery.Type;
const ArkMemoryReadResult = Schema.Struct({
  kind: Schema.Literal("memory"),
  id: Schema.Number,
  text: Schema.String,
});
export const ArkSearchResult = Schema.Struct({
  kind: Schema.Literal("search"),
  query: Schema.String,
  facts: Schema.Array(ArkMemory),
  moreFacts: Schema.Boolean,
  notes: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      title: Schema.String,
      kind: Schema.String,
      snippet: Schema.String,
    }),
  ),
});
export const ArkNoteReadResult = Schema.Struct({
  kind: Schema.Literal("note"),
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  updatedAt: Schema.String,
  revision: Schema.String,
  source: Schema.NullOr(
    Schema.Struct({
      path: Schema.String,
      relativePath: Schema.String,
      checkedAt: Schema.String,
      state: Schema.Literals(["current", "corrected", "conflict", "missing"]),
    }),
  ),
});
export const ArkSkillReadResult = Schema.Struct({
  kind: Schema.Literal("skill"),
  name: Schema.String,
  source: Schema.Literals(["ark", "personal"]),
  file: Schema.String,
  body: Schema.String,
  offset: Schema.Number,
  totalChars: Schema.Number,
  nextOffset: Schema.NullOr(Schema.Number),
});
export const ArkKnowledgeResult = Schema.Union([
  ArkAgentPolicy,
  ArkMemoryReadResult,
  ArkSearchResult,
  ArkNoteReadResult,
  ArkSkillReadResult,
]);
export type ArkKnowledgeResult = typeof ArkKnowledgeResult.Type;

export const ArkSourceRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("get") }),
  Schema.Struct({
    action: Schema.Literal("preview"),
    path: Schema.String,
    documents: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("connect"), token: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("restore"),
    id: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({ action: Schema.Literals(["refresh", "cancel", "disconnect"]) }),
]);
export type ArkSourceRequest = typeof ArkSourceRequest.Type;
export const ArkSourceResult = Schema.Struct({
  state: Schema.Struct({
    folder: Schema.optionalKey(
      Schema.Struct({
        id: Schema.String,
        path: Schema.String,
        identity: Schema.String,
        checkedAt: Schema.String,
        skipped: Schema.Number,
        documents: Schema.optionalKey(Schema.Boolean),
      }),
    ),
    notes: Schema.Number,
    corrected: Schema.Number,
    conflicts: Schema.Number,
    missing: Schema.Number,
    excluded: Schema.Number,
  }),
  preview: Schema.optionalKey(
    Schema.Struct({
      token: Schema.String,
      path: Schema.String,
      files: Schema.Array(Schema.String),
      count: Schema.Number,
      skipped: Schema.Number,
    }),
  ),
  error: Schema.optionalKey(Schema.String),
});
export type ArkSourceResult = typeof ArkSourceResult.Type;

export const ArkDraftContextItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  text: Schema.String,
  revision: Schema.String,
  truncated: Schema.Boolean,
  source: Schema.optionalKey(Schema.String),
});
export type ArkDraftContextItem = typeof ArkDraftContextItem.Type;
export const ArkDraftLookupInput = Schema.Struct({ query: Schema.String });
export const ArkDraftContextResult = Schema.Struct({ items: Schema.Array(ArkDraftContextItem) });
export const ArkDraftInput = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID()),
  modelSelection: ModelSelection,
  conversation: Schema.String,
  intent: Schema.String,
  background: Schema.String,
  examples: Schema.String,
  context: Schema.Array(Schema.Struct({ id: Schema.String, revision: Schema.String })),
});
export type ArkDraftInput = typeof ArkDraftInput.Type;
export const ArkDraftResult = Schema.Struct({
  text: Schema.String,
  modelSelection: ModelSelection,
});

const ArkButtonStep = Schema.Struct({
  button: Schema.String,
  expect: Schema.Struct({ label: Schema.String, value: Schema.String }),
});
export const ArkComputerInput = Schema.Struct({
  action: Schema.Literals([
    "status",
    "list_apps",
    "windows",
    "look",
    "open",
    "click",
    "click_sequence",
    "choose_sequence",
    "type",
    "key",
    "scroll",
    "set_value",
  ]),
  app: Schema.optionalKey(Schema.String),
  window_id: Schema.optionalKey(Schema.Int),
  query: Schema.optionalKey(Schema.String),
  element: Schema.optionalKey(Schema.Int),
  text: Schema.optionalKey(Schema.String),
  look_after: Schema.optionalKey(Schema.Boolean),
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
  direction: Schema.optionalKey(Schema.Literals(["up", "down", "left", "right"])),
  mode: Schema.optionalKey(Schema.Literals(["background", "foreground"])),
  steps: Schema.optionalKey(Schema.Array(ArkButtonStep)),
  goal: Schema.optionalKey(Schema.String),
  plans: Schema.optionalKey(
    Schema.Array(Schema.Struct({ description: Schema.String, steps: Schema.Array(ArkButtonStep) })),
  ),
});
export type ArkComputerInput = typeof ArkComputerInput.Type;
export const ArkComputerConfig = Schema.Struct({
  enabled: Schema.Boolean,
  mode: Schema.Literals(["background", "foreground"]),
  provider: Schema.Literals(["off", "laya", "jev"]),
  backup: Schema.Boolean,
});
export type ArkComputerConfig = typeof ArkComputerConfig.Type;
export const ArkComputerResult = Schema.Struct({
  text: Schema.String,
  images: Schema.Array(
    Schema.Struct({ mimeType: Schema.Literals(["image/png", "image/jpeg"]), data: Schema.String }),
  ),
});
export type ArkComputerResult = typeof ArkComputerResult.Type;
export const ArkComputerState = Schema.Struct({
  config: ArkComputerConfig,
  hasJevKey: Schema.Boolean,
  message: Schema.String,
  active: Schema.NullOr(
    Schema.Struct({
      request: Schema.String,
      threadId: Schema.String,
      title: Schema.String,
      action: Schema.String,
      phase: Schema.Literals(["running", "approval", "stopping", "blocked"]),
      approval: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          kind: Schema.Literals(["grant", "action"]),
          summary: Schema.String,
          reason: Schema.String,
        }),
      ),
    }),
  ),
});
export type ArkComputerState = typeof ArkComputerState.Type;
export const ArkComputerSettingsInput = Schema.Struct({
  config: ArkComputerConfig,
  jevKey: Schema.optionalKey(Schema.String),
  removeKey: Schema.optionalKey(Schema.Boolean),
  forgetGrants: Schema.optionalKey(Schema.Boolean),
});
export type ArkComputerSettingsInput = typeof ArkComputerSettingsInput.Type;
export const ArkComputerAnswer = Schema.Struct({
  request: Schema.String.check(Schema.isUUID()),
  id: Schema.String.check(Schema.isUUID()),
  approved: Schema.Boolean,
});

export const ArkVoiceInput = Schema.Union([
  Schema.Struct({
    requestId: Schema.String.check(Schema.isUUID()),
    kind: Schema.Literal("transcribe"),
    pcm: Schema.String.check(Schema.isMaxLength(2_560_000)),
  }),
  Schema.Struct({
    requestId: Schema.String.check(Schema.isUUID()),
    kind: Schema.Literal("speak"),
    text: Schema.String.check(Schema.isMaxLength(8000)),
  }),
]);
export type ArkVoiceInput = typeof ArkVoiceInput.Type;
export const ArkVoiceResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("transcribe"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("speak"),
    wav: Schema.String.check(Schema.isMaxLength(24_000_000)),
  }),
]);
export type ArkVoiceResult = typeof ArkVoiceResult.Type;
