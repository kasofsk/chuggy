/**
 * The worker plane's ports answering the least they can, for the cases that are
 * about something else. Both plane suites compose one, so it lives here rather
 * than twice: a fixture kept in two places is two fixtures the moment a port
 * grows a method.
 */

import type { WorkerPlaneServerService } from "../../src/adapters/http/workerPlaneServer.ts";

/**
 * The attempt half of a whole plane, inert throughout, for a case that is about
 * the session half or about nothing this plane holds. The upload bound is the
 * caller's because it is the one field a case ever makes its subject.
 */
export function inertWorkerPlane(
  uploadBytesMax: number,
): Omit<WorkerPlaneServerService, "sessions"> {
  void uploadBytesMax;
  return {
    ready: () => Promise.resolve(true),
  };
}
