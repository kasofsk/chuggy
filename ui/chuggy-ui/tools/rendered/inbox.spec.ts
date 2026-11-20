/**
 * The inbox at a phone's width and the desk's: an evaluation approval asking
 * this reader, an escalation whose title runs past a phone and a ticket its
 * phase alone puts there, each group under its heading. The phone's is under a coarse pointer, as a phone's is. Neither
 * scrolls the page sideways, at rest or with Revoke's dialog open; on the
 * phone every control the page and the dialog draw is at least the touch
 * height; and every read is one the stub answers.
 */

import { inboxResponseSchema } from "../../../../src/contract/responses.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import { servedOpen } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const inboxViewports: readonly RenderedViewport[] = ["phone", "desk"];

const inboxPath = `/${stubApiTenant}/${stubApiProject}/inbox`;

const inboxReadPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/inbox`;

function inboxTicket(
  ticket: number,
  phase: string,
  title: string,
  over: Readonly<Record<string, unknown>> = {},
) {
  return {
    ticket,
    title,
    phase,
    sequence: ticket,
    revision: 1,
    releasedAt: "2026-11-01T00:00:00Z",
    changedAt: "2026-11-02T00:00:00Z",
    revokedDependencies: [],
    openDependencies: [],
    ...over,
  };
}

function inboxEntry(
  ticket: ReturnType<typeof inboxTicket>,
  over: Readonly<Record<string, unknown>> = {},
) {
  return { ticket, actions: [], ...over };
}

const inboxEntries = [
  inboxEntry(inboxTicket(11, "Evaluation", "Release notes"), {
    actions: [
      {
        ticket: 11,
        action: "action-rendered",
        kind: "EvaluationApproval",
        authorizingSequence: 51,
        admits: ["Approve", "Reject"],
        answerable: true,
        approval: {
          execution: "execution-rendered",
          workCycle: 2,
          stage: 1,
          generation: 1,
          evaluator: 1,
          instructions:
            "Read every changed page of the release notes against the tickets it names before passing it",
          approvers: "Developer",
        },
      },
    ],
  }),
  inboxEntry(
    inboxTicket(
      4,
      "Escalated",
      "Draw every item of the inbox from the one record list primitive the console shares",
      {
        escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
      },
    ),
  ),
  inboxEntry(inboxTicket(42, "Pending", "Write the brief")),
];

for (const viewport of inboxViewports)
  test(`the inbox and Revoke's dialog do not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
  }) => {
    const served = await servedOpen({
      root: renderedDist,
      reads: [
        stubApiRead(inboxReadPath, inboxResponseSchema, {
          entries: inboxEntries,
          count: inboxEntries.length,
          more: false,
        }),
      ],
    });
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: inboxPath,
        viewport,
        touch: viewport === "phone",
        signedIn: true,
        ready: (page) => page.getByRole("heading", { name: /^Questions/u }),
      });
      const page = rendered.page;
      const inbox = page.locator(".inbox-page");
      await expect(inbox.getByRole("heading", { level: 2 })).toHaveText([
        /^Approvals/u,
        /^Questions/u,
      ]);
      await expect(inbox.getByRole("heading", { level: 3 })).toHaveCount(3);
      await renderedNoOverflow(page);
      if (viewport === "phone") await renderedTouchTargets(page, inbox);
      await page.getByRole("button", { name: "revoke" }).click();
      const dialog = page.getByRole("dialog", { name: "Revoke this ticket?" });
      await expect(dialog).toBeVisible();
      await renderedNoOverflow(page);
      if (viewport === "phone") await renderedTouchTargets(page, dialog);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
