/**
 * Drill one: a ticket created from the console's own form reaches a project
 * table nobody reloaded, and the transition that follows reaches it the same way.
 *
 * The table is watched in a second tab that is opened once and never navigated
 * again, because a screen that refetched on its own navigation would pass this
 * whether or not a frame ever arrived. What the selector dispatches is not this
 * drill's to require: a rig running it at no replicas reports the frames that
 * did arrive instead of failing.
 *
 * RELEASING A DRAFT NEEDS THE JOURNALLED ACTOR, so this drill states that as a
 * precondition and skips when the installation has none up. A skip is not a
 * pass, and it is the honest verdict when nothing the console does could have
 * settled the release.
 */

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  actorReady,
  createTicket,
  drill,
  evidence,
  frameTimeoutMs,
  openProject,
  panel,
  ticketLink,
} from "./rig.ts";

/** How long a dispatch is waited for before the drill reports that none came. */
const dispatchTimeoutMs = 60_000;

/** Whether anything ran for this ticket, an empty panel being an answer and not a failure. */
async function executionsReached(page: Page): Promise<boolean> {
  return page
    .locator("li.execution")
    .first()
    .waitFor({ state: "visible", timeout: dispatchTimeoutMs })
    .then(
      () => true,
      () => false,
    );
}

drill(
  "a created ticket and its transition reach an unreloaded table",
  async ({ signedIn, context }) => {
    drill.skip(
      !(await actorReady()),
      "the installation has no journalled actor up, so no release can settle",
    );
    const table = await context.newPage();
    await openProject(table);
    const ticket = await createTicket(
      signedIn.page,
      `rig acceptance, ticket created at ${new Date().toISOString()}`,
    );
    drill.info().annotations.push({
      type: "ticket",
      description: `created ticket ${String(ticket)}`,
    });

    await expect(ticketLink(panel(table, "up next"), ticket)).toBeVisible({
      timeout: frameTimeoutMs,
    });
    await evidence(table, "drill1-created-row-live");

    const ran = await executionsReached(signedIn.page);
    if (ran) {
      await expect(
        signedIn.page.locator(".execution-status").first(),
      ).not.toBeEmpty();
    } else {
      await expect(
        panel(signedIn.page, "executions").getByText(
          "nothing has run for this ticket",
        ),
      ).toBeVisible();
    }
    drill.info().annotations.push({
      type: "dispatch",
      description: ran
        ? "an execution arrived and carried a status"
        : "no execution arrived inside the wait; the Draft and Ticket frames are what this drill observed",
    });
    await evidence(signedIn.page, "drill1-ticket-page");

    await signedIn.page.getByRole("button", { name: "revoke" }).click();
    await expect(
      ticketLink(panel(table, "failed or revoked"), ticket),
    ).toBeVisible({ timeout: frameTimeoutMs });
    await expect(ticketLink(panel(table, "up next"), ticket)).toHaveCount(0);
    await evidence(table, "drill1-transition-live");
  },
);
