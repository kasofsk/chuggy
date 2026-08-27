/**
 * Drill two: revoking a ticket another one depends on escalates the second, and
 * the badge, the inbox row and the answer all move without a reload.
 *
 * `DependencyRevoked` is the escalation a person can cause through the console
 * alone, and it is the one a resume cannot answer — the parked ticket carries no
 * resumption, so `retryableIn` refuses it and revoking is what resolves the row.
 * The badge is read before and after rather than asserted at a number, because
 * the inbox holds whatever the installation already had in it.
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
  "an escalation reaches the badge and the inbox, and the answer clears both",
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
    await expect
      .poll(() => inboxCount(watcher), { timeout: frameTimeoutMs })
      .toBe(held + 1);
    await evidence(watcher, "drill2-badge-live");

    await watcher.getByRole("link", { name: "inbox" }).click();
    const row = panel(watcher, "needs you")
      .getByRole("row")
      .filter({
        has: watcher.getByRole("link", {
          name: String(dependent),
          exact: true,
        }),
      });
    await expect(row).toBeVisible({ timeout: frameTimeoutMs });
    await expect(row.getByText("a dependency was revoked")).toBeVisible();
    await evidence(watcher, "drill2-inbox-row");

    await row.getByRole("button", { name: "revoke", exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: frameTimeoutMs });
    await expect
      .poll(() => inboxCount(watcher), { timeout: frameTimeoutMs })
      .toBe(held);
    await evidence(watcher, "drill2-answered");
  },
);
