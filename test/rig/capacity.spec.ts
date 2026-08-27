/**
 * Drill five: more event streams are held open than the API admits ordinary
 * requests, and an ordinary read still answers while the console keeps drawing.
 *
 * THE COUNT SITS BETWEEN TWO BOUNDS AND BOTH ARE NAMED. It must exceed what an
 * ordinary request is admitted against — `nativeHttpLimitsDefault`'s
 * `concurrentRequestsMax` in `src/adapters/http/server.ts`, which the events
 * route's `streaming` config exempts it from, and behind that the pool's
 * `postgresLimitsDefault.connectionsMax` in `src/adapters/postgres/pool.ts`,
 * which no environment overrides. It must stay under what the API will hold
 * open, and that one a deployment DOES raise, so it is read from the deployment
 * rather than assumed: a rig that lowered it fails this drill on its own
 * precondition instead of on a count nobody can explain.
 *
 * The streams are separate connections rather than one multiplexed reply,
 * because what is being asked is whether a stream occupies the counter an
 * ordinary request is admitted against.
 */

import { expect } from "@playwright/test";

import { projectStreamLimitsDefault } from "../../src/interpreter/projectStream.ts";
import {
  briefIntent,
  createDraft,
  deleteDraft,
  drill,
  evidence,
  frameTimeoutMs,
  holdStreams,
  openTicket,
  readProjectStatus,
  reviseDraftIntent,
  streamConnectionsMax,
} from "./rig.ts";

/** How many streams are held, and how long they are given to answer before counting. */
const streamsHeld = 70;
const settleMs = 15_000;

drill(
  "streams past the ordinary capacity leave reads and the console working",
  async ({ signedIn, context }) => {
    const cap = await streamConnectionsMax(
      projectStreamLimitsDefault.connectionsMax,
    );
    expect(streamsHeld).toBeLessThan(cap);

    const bearer = signedIn.bearer();
    const draft = await createDraft(bearer, "the capacity drill");
    const watcher = await context.newPage();
    await openTicket(watcher, draft);

    const streams = await holdStreams(bearer, streamsHeld, settleMs);
    try {
      drill.info().annotations.push({
        type: "streams",
        description: `${String(streams.connected)} of ${String(streamsHeld)} streams answered, against a cap of ${String(cap)}`,
      });
      expect(streams.connected).toBe(streamsHeld);
      expect(await readProjectStatus(bearer)).toBe(200);

      const written = await reviseDraftIntent(
        bearer,
        draft,
        "drawn while the streams were held",
      );
      await expect(briefIntent(watcher)).toHaveText(written, {
        timeout: frameTimeoutMs,
      });
      await evidence(watcher, "drill5-console-under-load");
    } finally {
      streams.close();
    }

    expect(await readProjectStatus(bearer)).toBe(200);
    await deleteDraft(bearer, draft);
  },
);
