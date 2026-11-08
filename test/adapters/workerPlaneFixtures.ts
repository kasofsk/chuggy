/**
 * The worker plane's ports answering the least they can, for the cases that are
 * about something else. Both plane suites compose one, so it lives here rather
 * than twice: a fixture kept in two places is two fixtures the moment a port
 * grows a method.
 */

import type { FastifyInstance } from "fastify";

import type {
  SessionPlaneService,
  WorkerPlaneServerService,
  WorkerRunEvidencePorts,
} from "../../src/adapters/http/workerPlaneServer.ts";
import { workerContractHeader } from "../../src/contract/workerContract.ts";
import type { SessionPlaneAuthority } from "../../src/interpreter/sessionPlane.ts";
import type { WorkerTaskPort } from "../../src/interpreter/workerPlane.ts";

/** A lease no fixture case renews and none is about. */
const workerPlaneFixtureLeaseSecs = 300;

/** The figures one run reports, which every totals case varies one field of. */
export const runTotalsBody = {
  turns: 2,
  durationMs: 10,
  durationApiMs: 5,
  tokensInput: 1,
  tokensOutput: 2,
  tokensCacheCreation: 3,
  tokensCacheRead: 4,
  costUsdMicros: 7,
  costBasis: "List",
  models: [],
  permissionDenials: 0,
} as const;

/** A compaction's reading of a run's context window, carrying every field a reading may. */
export const runContextReadingBody = {
  ordinal: 2,
  afterTurn: 7,
  cause: "Compaction",
  compaction: { trigger: "Auto", tokensBefore: 160_000, tokensAfter: 12_000 },
  window: {
    model: "claude-fixture",
    totalTokens: 12_000,
    maxTokens: 200_000,
    autoCompactThreshold: 167_000,
    categories: [
      { name: "System prompt", tokens: 3_000, kind: "Used" },
      { name: "Free space", tokens: 155_000, kind: "Free" },
      { name: "Autocompact buffer", tokens: 33_000, kind: "Buffer" },
      { name: "MCP tools", tokens: 900, kind: "Deferred" },
    ],
    memoryFiles: [{ path: "/workspace/repository/CLAUDE.md", tokens: 2_100 }],
    mcpTools: [{ server: "chuggy", name: "read_ticket", tokens: 300 }],
    systemTools: [{ name: "Bash", tokens: 1_200 }],
    systemPromptSections: [{ name: "Environment", tokens: 400 }],
    skills: {
      total: 2,
      included: 1,
      tokens: 80,
      items: [{ name: "layering", tokens: 80 }],
    },
    agents: [{ type: "Explore", tokens: 150 }],
    messages: {
      toolCalls: 2_000,
      toolResults: 4_000,
      attachments: 0,
      assistant: 1_000,
      user: 500,
      byTool: [{ name: "Bash", callTokens: 2_000, resultTokens: 4_000 }],
    },
  },
} as const;

/** A context window carrying none of the fields a window may leave out, and every list empty. */
export const runContextWindowBare = {
  model: "claude-fixture",
  totalTokens: 0,
  maxTokens: 200_000,
  categories: [],
  memoryFiles: [],
  mcpTools: [],
  systemTools: [],
  systemPromptSections: [],
  agents: [],
} as const;

/** Every run-evidence port a case about something else never reaches. */
export const inertRunEvidence: WorkerRunEvidencePorts = {
  configurations: { record: () => Promise.resolve("Stored") },
  transcripts: { record: () => Promise.resolve("Stored") },
  turns: {
    record: () => Promise.resolve({ recorded: "Recorded", turnsRecorded: 0 }),
  },
  totals: { record: () => Promise.resolve("Stored") },
  context: { record: () => Promise.resolve("Stored") },
  endings: { end: () => Promise.resolve(true) },
};

/** A task port that finds no attempt, for a case that never fetches one. */
export const inertTasks: WorkerTaskPort = {
  work: () => Promise.resolve(undefined),
  session: () => Promise.resolve(undefined),
};

/**
 * The attempt half of a whole plane, inert throughout, for a case that is about
 * the session half or about nothing this plane holds. The upload bound is the
 * caller's because it is the one field a case ever makes its subject.
 */
export function inertWorkerPlane(
  uploadBytesMax: number,
): Omit<WorkerPlaneServerService, "sessions"> {
  return {
    authority: { authenticate: () => Promise.resolve(undefined) },
    tasks: inertTasks,
    heartbeats: { heartbeat: () => Promise.resolve(true) },
    heartbeatLeaseSecs: workerPlaneFixtureLeaseSecs,
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    projectArtifacts: {
      readArtifact: () => Promise.resolve({ read: "NotFound" }),
    },
    reservations: {
      reserve: () => Promise.resolve({ reserved: "Reserved" }),
    },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    runEvidence: inertRunEvidence,
    ready: () => Promise.resolve(true),
    uploadBytesMax,
  };
}

/** The session half of a whole plane, every port but its authority answering the least it can. */
export function inertSessionPlane(
  authority: SessionPlaneAuthority,
): SessionPlaneService {
  return {
    authority,
    heartbeats: { heartbeat: () => Promise.resolve(true) },
    heartbeatLeaseSecs: workerPlaneFixtureLeaseSecs,
    references: { bind: () => Promise.resolve("Bound") },
    turns: { claim: () => Promise.resolve(undefined) },
    settlements: {
      answer: () => Promise.resolve("Answered"),
      fail: () => Promise.resolve("Failed"),
    },
    watches: { watched: () => Promise.resolve(undefined) },
    live: { publish: () => Promise.resolve("Published") },
    holds: { hold: () => Promise.resolve(true) },
    losses: {
      lose: () => Promise.resolve(true),
      turnFailure: () =>
        Promise.resolve({ turnFailure: undefined, sessionClosed: false }),
    },
    records: { record: () => Promise.resolve("Stored") },
    queries: {
      batches: () => Promise.resolve([]),
      streams: () => Promise.resolve([]),
    },
    store: {
      storeBatch: () => Promise.resolve({ stored: "Stored" }),
      readBatch: () => Promise.resolve({ read: "NotFound" }),
    },
    turnPollIntervalMs: 1_000,
    turnPollSecsMax: 1,
    pollsMax: 64,
  };
}

/** What a bearer is answered at the task route, as a pod naming `release`, or naming none, reads it. */
export async function taskFetched(
  plane: Pick<FastifyInstance, "inject">,
  bearer: string,
  release?: string,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await plane.inject({
    method: "GET",
    url: "/v1/task",
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(release === undefined ? {} : { [workerContractHeader]: release }),
    },
  });
  return {
    status: response.statusCode,
    body: JSON.parse(response.body) as unknown,
  };
}
