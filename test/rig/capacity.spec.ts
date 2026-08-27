/**
 * Drill five: more event streams are held open than the API admits ordinary
 * requests, and an ordinary read still answers while the console keeps drawing.
 *
 * The streams are separate connections rather than one multiplexed reply,
 * because what is being asked is whether a stream occupies the counter an
 * ordinary request is admitted against — and a route the counter exempts is the
 * whole of why it does not.
 */

import { expect } from "@playwright/test";

import {
  briefIntent,
  createDraft,
  drill,
  evidence,
  frameTimeoutMs,
  holdStreams,
  openTicket,
  readProjectStatus,
  reviseDraftIntent,
} from "./rig.ts";

/**
 * More streams than an API admits ordinary requests at once, which is what makes
 * the read below evidence rather than a coincidence, and how long they are given
 * to answer before they are counted.
 */
const streamsHeld = 70;
const settleMs = 15_000;

drill(
  "streams past the ordinary capacity leave reads and the console working",
  async ({ signedIn, context }) => {
    const bearer = signedIn.bearer();
    const draft = await createDraft(
      bearer,
      `rig acceptance, the capacity drill at ${new Date().toISOString()}`,
    );
    const watcher = await context.newPage();
    await openTicket(watcher, draft);

    const streams = await holdStreams(bearer, streamsHeld, settleMs);
    try {
      drill.info().annotations.push({
        type: "streams",
        description: `${String(streams.connected)} of ${String(streamsHeld)} streams answered`,
      });
      expect(streams.connected).toBe(streamsHeld);
      expect(await readProjectStatus(bearer)).toBe(200);

      const written = `drawn while the streams were held at ${new Date().toISOString()}`;
      await reviseDraftIntent(bearer, draft, written);
      await expect(briefIntent(watcher)).toHaveText(written, {
        timeout: frameTimeoutMs,
      });
      await evidence(watcher, "drill5-console-under-load");
    } finally {
      streams.close();
    }

    expect(await readProjectStatus(bearer)).toBe(200);
  },
);
