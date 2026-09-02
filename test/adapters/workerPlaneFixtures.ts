/**
 * The worker plane's ports answering the least they can, for the cases that are
 * about something else. Both plane suites compose one, so it lives here rather
 * than twice: a fixture kept in two places is two fixtures the moment a port
 * grows a method.
 */

import type {
  WorkerPlaneServerService,
  WorkerRunEvidencePorts,
} from "../../src/adapters/http/workerPlaneServer.ts";

/** A lease no fixture case renews and none is about. */
const workerPlaneFixtureLeaseSecs = 300;

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
