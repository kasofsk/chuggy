/**
 * Drill four: the API is restarted under an open stream, and the console
 * reconnects and draws a change made while it was disconnected.
 *
 * The change is made only once the console has SAID it is not live, so what is
 * proved is a recovery and not a rollout the browser happened to sleep through;
 * the deployed generation is read either side of the restart so that a rollout
 * which did nothing cannot pass this either. Whether the frame arrives replayed
 * from the last identifier or after a reset is the hub's decision: the screen
 * must end up showing it.
 */

import { expect } from "@playwright/test";

import {
  apiRevision,
  briefIntent,
  createDraft,
  deleteDraft,
  drill,
  evidence,
  notLiveBanner,
  onRig,
  openTicket,
  recoveryTimeoutMs,
  reviseDraftIntent,
  rigApiDeployment,
  rigDeploymentKind,
  rigNamespace,
  throughRestart,
} from "./rig.ts";

drill(
  "a restarted API is reconnected to and misses nothing retained",
  async ({ signedIn, context }) => {
    const bearer = signedIn.bearer();
    const draft = await createDraft(bearer, "the restart drill");
    const watcher = await context.newPage();
    await openTicket(watcher, draft);
    const before = await apiRevision();

    const dropped = notLiveBanner(watcher).waitFor({
      state: "visible",
      timeout: recoveryTimeoutMs,
    });
    await onRig([
      "kubectl",
      "-n",
      rigNamespace,
      "rollout",
      "restart",
      rigDeploymentKind,
      rigApiDeployment,
    ]);
    await dropped;
    await evidence(watcher, "drill4-stream-dropped");

    const written = await throughRestart(() =>
      reviseDraftIntent(bearer, draft, "written while disconnected"),
    );
    await onRig([
      "kubectl",
      "-n",
      rigNamespace,
      "rollout",
      "status",
      rigDeploymentKind,
      rigApiDeployment,
      "--timeout=180s",
    ]);

    await expect(briefIntent(watcher)).toHaveText(written, {
      timeout: recoveryTimeoutMs,
    });
    await expect(notLiveBanner(watcher)).toHaveCount(0, {
      timeout: recoveryTimeoutMs,
    });
    const after = await apiRevision();
    expect(after).not.toBe(before);
    drill.info().annotations.push({
      type: "restart",
      description: `generation ${before} became ${after} while draft ${String(draft)} was rewritten`,
    });
    await evidence(watcher, "drill4-reconnected");
    await throughRestart(() => deleteDraft(bearer, draft));
  },
);
