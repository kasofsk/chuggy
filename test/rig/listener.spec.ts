/**
 * Drill three: the API's listener is terminated under the console, which says it
 * is not live, keeps reading on its bounded fallback, and converges when the
 * listener comes back.
 *
 * The listener reconnects on a jittered backoff whose first wait is well under a
 * second, so one termination would be a state too brief to have been observed.
 * It is terminated repeatedly for a named window instead, which is what makes
 * the degraded banner and the fallback read evidence rather than a race.
 */

import { expect } from "@playwright/test";

import {
  briefIntent,
  createDraft,
  drill,
  evidence,
  frameTimeoutMs,
  notLiveBanner,
  openTicket,
  recoveryTimeoutMs,
  reviseDraftIntent,
  terminateListener,
} from "./rig.ts";

/** How long the listener is held down for, and how often it is terminated inside that. */
const outageMs = 45_000;
const outageIntervalMs = 2_000;

drill(
  "a terminated listener degrades the console, which keeps reading and converges",
  async ({ signedIn, context }) => {
    const bearer = signedIn.bearer();
    const draft = await createDraft(
      bearer,
      `rig acceptance, the listener drill at ${new Date().toISOString()}`,
    );
    const watcher = await context.newPage();
    await openTicket(watcher, draft);

    const endsAtMs = Date.now() + outageMs;
    const outage = (async () => {
      let ended = 0;
      while (Date.now() < endsAtMs) {
        ended += await terminateListener();
        await new Promise((resolve) => setTimeout(resolve, outageIntervalMs));
      }
      return ended;
    })();

    await expect(notLiveBanner(watcher)).toBeVisible({
      timeout: recoveryTimeoutMs,
    });
    await expect(notLiveBanner(watcher)).toContainText("not live");
    await evidence(watcher, "drill3-not-live");

    const degraded = `read on the fallback at ${new Date().toISOString()}`;
    await reviseDraftIntent(bearer, draft, degraded);
    await expect(briefIntent(watcher)).toHaveText(degraded, {
      timeout: recoveryTimeoutMs,
    });
    await evidence(watcher, "drill3-fallback-read");

    drill.info().annotations.push({
      type: "listener",
      description: `terminated ${String(await outage)} listening backend(s)`,
    });

    await expect(notLiveBanner(watcher)).toHaveCount(0, {
      timeout: recoveryTimeoutMs,
    });
    const live = `drawn live again at ${new Date().toISOString()}`;
    await reviseDraftIntent(bearer, draft, live);
    await expect(briefIntent(watcher)).toHaveText(live, {
      timeout: frameTimeoutMs,
    });
    await evidence(watcher, "drill3-live-again");
  },
);
