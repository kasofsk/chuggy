/**
 * Drill two: revoking a ticket another one depends on strands the second, and
 * the row it leaves behind says so without a reload.
 *
 * A revoke transitions its own ticket and nothing else, so the dependent stays
 * Pending on a dependency that will never be Done, and revoking it too is the
 * only exit. Nothing is parked on the desk for it: the badge is read before and
 * asserted unmoved after the stranded row has arrived, rather than on a timer,
 * because a badge that has not moved yet looks exactly like one that will not.
 */

import { expect } from "@playwright/test";

import {
  createTicket,
  deploymentReady,
  drill,
  evidence,
  frameTimeoutMs,
  inboxCount,
  openProject,
  openTicket,
  panel,
  rigActorDeployment,
} from "./rig.ts";

drill(
  "a revoked dependency strands its dependent, and the row says so live",
  async ({ signedIn, context }) => {
    drill.skip(
      !(await deploymentReady(rigActorDeployment)),
      "the installation has no journalled actor up, so no release can settle",
    );
    const watcher = await context.newPage();
    await openProject(watcher);
    const held = await inboxCount(watcher);

    const at = new Date().toISOString();
    const dependency = await createTicket(
      signedIn.page,
      `the dependency at ${at}`,
    );
    const dependent = await createTicket(
      signedIn.page,
      `the dependent at ${at}`,
      dependency,
    );
    drill.info().annotations.push({
      type: "tickets",
      description: `${String(dependent)} depends on ${String(dependency)}`,
    });

    await openTicket(signedIn.page, dependency);
    await signedIn.page.getByRole("button", { name: "revoke" }).click();

    const stranded = panel(watcher, "up next")
      .getByRole("row")
      .filter({
        has: watcher.getByRole("link", {
          name: String(dependent),
          exact: true,
        }),
      });
    await expect(
      stranded.getByText(/blocked by revoked dependenc/iu),
    ).toBeVisible({ timeout: frameTimeoutMs });
    await evidence(watcher, "drill2-stranded-row-live");
    expect(await inboxCount(watcher)).toBe(held);

    await openTicket(signedIn.page, dependent);
    await signedIn.page.getByRole("button", { name: "revoke" }).click();
    await expect(stranded).toHaveCount(0, { timeout: frameTimeoutMs });
    await evidence(watcher, "drill2-revoked-out");
  },
);
