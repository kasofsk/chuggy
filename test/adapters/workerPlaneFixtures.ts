/**
 * The worker plane's ports answering the least they can, for the cases that are
 * about something else. Both plane suites compose one, so it lives here rather
 * than twice: a fixture kept in two places is two fixtures the moment a port
 * grows a method.
 */

import type {
  SessionPlaneService,
  WorkerPlaneServerService,
  WorkerRunEvidencePorts,
} from "../../src/adapters/http/workerPlaneServer.ts";
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

/** Every run-evidence port a case about something else never reaches. */
export const inertRunEvidence: WorkerRunEvidencePorts = {
  configurations: { record: () => Promise.resolve("Stored") },
  transcripts: { record: () => Promise.resolve("Stored") },
  turns: {
    record: () => Promise.resolve({ recorded: "Recorded", turnsRecorded: 0 }),
  },
  totals: { record: () => Promise.resolve("Stored") },
  endings: { end: () => Promise.resolve(true) },
};

/** A task port that finds no attempt, for a case that never fetches one. */
export const inertTasks: WorkerTaskPort = {
  task: () => Promise.resolve(undefined),
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
    holds: { hold: () => Promise.resolve(true) },
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
