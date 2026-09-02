/**
 * The worker plane's ports answering the least they can, for the cases that are
 * about something else. Both plane suites compose one, so it lives here rather
 * than twice: a fixture kept in two places is two fixtures the moment a port
 * grows a method.
 */

import type { WorkerRunEvidencePorts } from "../../src/adapters/http/workerPlaneServer.ts";

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
