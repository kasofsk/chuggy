/**
 * Drill one, in two halves, because #325's first criterion asks for two things
 * and an installation can be able to show one without the other.
 *
 * THE CREATION HALF needs the journalled actor, because releasing a draft is its
 * work. THE EXECUTION HALF needs it too, and dispatches the released ticket by
 * hand from its page. Each states what it needs and skips when the
 * installation has not got it, and a skip is what
 * `test/rig/verdict.ts` turns into a could-not-run: a run that could not exercise
 * a numbered criterion must not report that it did.
 *
 * The table is watched in a second tab that is opened once and never navigated
 * again, because a screen that refetched on its own navigation would pass this
 * whether or not a frame ever arrived.
 */

import { expect } from "@playwright/test";

import {
  createTicket,
  deploymentReady,
  drill,
  evidence,
  frameTimeoutMs,
  mutationTimeoutMs,
  openProject,
  panel,
  rigActorDeployment,
  ticketLink,
} from "./rig.ts";

/** How long a dispatched execution is waited for before the drill gives up on it. */
const dispatchTimeoutMs = 120_000;

const noActor =
  "the installation has no journalled actor up, so no release can settle";

drill(
  "a created ticket and its transition reach an unreloaded table",
  async ({ signedIn, context }) => {
    drill.skip(!(await deploymentReady(rigActorDeployment)), noActor);
    const table = await context.newPage();
    await openProject(table);
    const ticket = await createTicket(
      signedIn.page,
      `ticket created at ${new Date().toISOString()}`,
    );
    drill.info().annotations.push({
      type: "ticket",
      description: `created ticket ${String(ticket)}`,
    });

    await expect(ticketLink(panel(table, "up next"), ticket)).toBeVisible({
      timeout: frameTimeoutMs,
    });
    await evidence(table, "drill1-created-row-live");

    await signedIn.page.getByRole("button", { name: "revoke" }).click();
    await expect(
      ticketLink(panel(table, "failed or revoked"), ticket),
    ).toBeVisible({ timeout: frameTimeoutMs });
    await expect(ticketLink(panel(table, "up next"), ticket)).toHaveCount(0);
    await evidence(table, "drill1-transition-live");
  },
);

drill(
  "a dispatched ticket's execution appears with its status",
  async ({ signedIn }) => {
    drill.skip(!(await deploymentReady(rigActorDeployment)), noActor);
    const ticket = await createTicket(
      signedIn.page,
      `execution observed at ${new Date().toISOString()}`,
    );
    await signedIn.page
      .getByRole("button", { name: "Dispatch", exact: true })
      .click({ timeout: mutationTimeoutMs });
    await signedIn.page
      .getByRole("dialog", { name: `Dispatch ticket #${String(ticket)}?` })
      .getByRole("button", { name: "Dispatch", exact: true })
      .click({ timeout: frameTimeoutMs });
    const executions = panel(signedIn.page, "executions");
    await expect(executions.locator("li.execution").first()).toBeVisible({
      timeout: dispatchTimeoutMs,
    });
    await expect(
      signedIn.page.locator(".execution-status").first(),
    ).not.toBeEmpty();
    await evidence(signedIn.page, "drill1-execution");
    drill.info().annotations.push({
      type: "ticket",
      description: `created ticket ${String(ticket)} and observed an execution`,
    });
    await signedIn.page.getByRole("button", { name: "revoke" }).click();
  },
);
