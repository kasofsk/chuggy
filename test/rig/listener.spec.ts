/**
 * Drill three, in two halves, because the console is degraded by two different
 * things and only one of them can be held still long enough to read on.
 *
 * THE LISTENER HALF is #325's first and third clauses: the API's `LISTEN`
 * backend is terminated, the console says the change log behind its stream is
 * degraded, and a change made after the doorbell returns is drawn live. It is
 * terminated repeatedly across a window because `projectChangeBackoffMs`'s first
 * wait is `reconnectBaseMs` with a half-jitter — a fraction of a second — so a
 * single termination is a state too brief to have been observed.
 *
 * THE FALLBACK HALF cannot be built on that, and the arithmetic is why.
 * `runProjectFallback` sleeps `fallbackIntervalMs` BEFORE its first refetch, and
 * `useStreamFallback` aborts and restarts the loop on every transition out of
 * degraded, so a console that is degraded in fractions of a second between
 * reconnections never completes one sleep. Holding the SOURCE degraded for
 * longer would mean refusing the API's database sessions, which is a lockout of
 * a live role and is not a thing this suite does to an installation. So the
 * second half induces the other degraded state instead: the browser's own
 * stream requests are refused, which `stream.tsx` folds into the same `degraded`
 * boolean the source does, and which nothing but this test can end. The fallback
 * loop that then runs is the same loop either way — one boolean, one effect.
 *
 * The refusal is in place BEFORE the page is opened, because a route intercepts
 * what a browser asks for next and the stream a live page already holds is not
 * asked for again. So that half also shows the page drawing its first read with
 * no stream at all, which is the other thing a fallback is for.
 *
 * `Opening` IS NOT CARRYING, WHICH IS WHAT MAKES THE BOUND SMALL. The browser
 * reopens on a ladder of `streamReopenDelayMsMin` doubling toward
 * `streamReopenDelayMsMax` and every attempt passes back through `Opening`,
 * which `projectStreamCarrying` answers no for — so the loop is started once,
 * when the page mounts, and is not aborted at any rung of that ladder. The
 * refusal is never lifted while the drill runs, so the banner is asserted still
 * up at the instant the text arrives: the read cannot have been the stream's.
 *
 * This half does not put the stream back. A console that has given up needs a
 * reload to reopen one, and a reload is what this suite never does; the half
 * above is where coming back live is established.
 */

import { expect } from "@playwright/test";

import { fallbackIntervalMs } from "../../ui/chuggy-ui/app/core/projectFallback.ts";
import {
  awaitLive,
  briefIntent,
  createDraft,
  deleteDraft,
  drill,
  evidence,
  frameTimeoutMs,
  isStreamRequest,
  notLiveBanner,
  openTicket,
  openTicketPage,
  readProjectStatus,
  recoveryTimeoutMs,
  reviseDraftIntent,
  terminateListener,
} from "./rig.ts";

/** How long the listener is held down for, and how often it is terminated inside that. */
const outageMs = 45_000;
const outageIntervalMs = 2_000;

/**
 * How long a fallback read is waited for: `runProjectFallback` sleeps
 * `fallbackIntervalMs` before each refetch and runs from the page's mount, so a
 * change written just after one refetch has gone is drawn by the next — two
 * intervals, and a third for the round trip. NOT YET CONFIRMED ON A RIG, being
 * the loop's arithmetic rather than a measurement, so widen it here if tight.
 */
const fallbackReadTimeoutMs = fallbackIntervalMs * 3;

drill(
  "repeated listener loss degrades the console and it converges",
  async ({ signedIn, context }) => {
    const bearer = signedIn.bearer();
    const draft = await createDraft(bearer, "the listener drill");
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
    expect(await readProjectStatus(bearer)).toBe(200);

    drill.info().annotations.push({
      type: "listener",
      description: `terminated ${String(await outage)} listening backend(s)`,
    });
    await awaitLive(watcher);

    const live = await reviseDraftIntent(bearer, draft, "drawn live again");
    await expect(briefIntent(watcher)).toHaveText(live, {
      timeout: frameTimeoutMs,
    });
    await evidence(watcher, "drill3-live-again");
    await deleteDraft(bearer, draft);
  },
);

drill(
  "a console with no stream reads on its bounded fallback",
  async ({ signedIn, context }) => {
    const bearer = signedIn.bearer();
    const draft = await createDraft(bearer, "the fallback drill");
    const watcher = await context.newPage();
    await watcher.route(isStreamRequest, (route) => route.abort());
    try {
      await openTicketPage(watcher, draft);
      await expect(briefIntent(watcher)).toContainText("the fallback drill");
      await expect(notLiveBanner(watcher)).toBeVisible({
        timeout: frameTimeoutMs,
      });
      await evidence(watcher, "drill3-no-stream");
      const written = await reviseDraftIntent(
        bearer,
        draft,
        "read on fallback",
      );
      await expect(briefIntent(watcher)).toHaveText(written, {
        timeout: fallbackReadTimeoutMs,
      });
      await expect(notLiveBanner(watcher)).toBeVisible();
      await evidence(watcher, "drill3-fallback-read");
    } finally {
      await watcher.unroute(isStreamRequest);
      await deleteDraft(bearer, draft);
    }
  },
);
