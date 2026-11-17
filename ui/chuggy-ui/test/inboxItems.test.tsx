/**
 * The inbox as a list: its items grouped by what they ask under a heading and
 * a count each, every answer the inbox offers reachable from the item it
 * answers with one primary among them, an answer that cannot be undone asked
 * in a dialog and one that can asked in place, and focus kept once an answered
 * item leaves.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type {
  InboxEntryResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { inboxAnswered, inboxEntry, inboxItemOf } from "./inboxFixture.ts";
import { leadRefusals } from "./leadFixture.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { frame } from "./streamDouble.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: () => (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function escalatedTicket(ticket: number): ProjectTicket {
  return {
    ticket,
    title: `Escalated ${String(ticket)}`,
    phase: "Escalated",
    sequence: ticket,
    escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
    ...ticketInstants,
  };
}

const approvalAsked: ProjectNativeActionResponse = {
  ticket: 11,
  action: "action-eval",
  kind: "EvaluationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Reject"],
  answerable: true,
  approval: {
    execution: "e-approval",
    workCycle: 2,
    stage: 1,
    generation: 1,
    evaluator: 1,
    approvers: "Developer",
  },
};

const approval = inboxEntry(
  { ticket: 11, phase: "Evaluation", sequence: 11, ...ticketInstants },
  { actions: [approvalAsked] },
);

const proposal = inboxEntry(
  { ticket: 7, phase: "Pending", sequence: 7, ...ticketInstants },
  { proposals: [{ decision: "dec-one", tickets: [7] }] },
);

const refusal = inboxEntry(
  { ticket: 42, phase: "Pending", sequence: 42, ...ticketInstants },
  { refusals: leadRefusals(false).refusals },
);

const everyKind = [inboxEntry(escalatedTicket(4)), proposal, refusal, approval];

/** The inbox over the entries `held` answers with as it is read, and the
 * stream its frames are pushed down. */
function drawInbox(held: () => readonly InboxEntryResponse[]) {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) =>
      inboxAnswered(url, held()) ??
      (url.includes("/executions")
        ? answer({ executions: [] })
        : answer({ partition: atlas, sequence: 9, tickets: [] })),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return { api, server };
}

function buttonsOf(ticket: number): readonly string[] {
  return within(inboxItemOf(ticket))
    .queryAllByRole("button")
    .map((button) => button.textContent);
}

function primariesOf(ticket: number): number {
  return inboxItemOf(ticket).querySelectorAll(".btn-primary").length;
}

test("the items are grouped approvals, proposals, questions, each under a heading with its count", async () => {
  drawInbox(() => everyKind);
  await settled();
  expect(
    screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toStrictEqual([
    "Approvals11 waiting",
    "Proposals11 waiting",
    "Questions22 waiting",
  ]);
  expect(
    screen.getAllByRole("list").map((list) => ({
      group: list.getAttribute("aria-label"),
      items: within(list).getAllByRole("listitem").length,
    })),
  ).toStrictEqual([
    { group: "Approvals", items: 1 },
    { group: "Proposals", items: 1 },
    { group: "Questions", items: 2 },
  ]);
  expect(
    within(inboxItemOf(4)).getByRole("heading", { level: 3 }).textContent,
  ).toBe("Resume this ticket, or revoke it?");
});

test("a group no item is in is not drawn, and an empty inbox is one line", async () => {
  let entries: readonly InboxEntryResponse[] = [inboxEntry(escalatedTicket(4))];
  const { server } = drawInbox(() => entries);
  await settled();
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.id),
  ).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: /^Approvals/u })).toBeNull();
  expect(screen.queryByRole("heading", { name: /^Proposals/u })).toBeNull();
  entries = [];
  await turned(() => {
    server.push(
      frame("NativeAction", "12", {
        version: 1,
        resource: "4",
        representation: { actions: [] },
      }),
    );
  });
  await settled();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});

test("every answer the inbox offers is reachable from the item it answers, with one primary each", async () => {
  drawInbox(() => everyKind);
  await settled();
  expect(buttonsOf(11)).toStrictEqual(["Approve", "Reject"]);
  expect(buttonsOf(7)).toStrictEqual(["approve", "reject"]);
  expect(buttonsOf(4)).toStrictEqual(["resume", "revoke"]);
  expect(buttonsOf(42)).toStrictEqual([]);
  expect(
    within(inboxItemOf(42)).getByText("no action can be sent from here yet"),
  ).toBeDefined();
  for (const ticket of [11, 7, 4]) expect(primariesOf(ticket)).toBe(1);
  expect(
    within(inboxItemOf(4)).getByRole("button", { name: "resume" }).className,
  ).toContain("btn-primary");
  expect(
    within(inboxItemOf(7)).getByRole("button", { name: "approve" }).className,
  ).toContain("btn-primary");
  expect(
    within(inboxItemOf(11)).getByRole("button", { name: "Approve" }).className,
  ).toContain("btn-primary");
});

test("revoke, which cannot be undone, asks in a dialog; a rejection, which can, asks in place", async () => {
  drawInbox(() => everyKind);
  await settled();
  await turned(() => {
    within(inboxItemOf(4)).getByRole("button", { name: "revoke" }).click();
  });
  expect(
    screen.getByRole("dialog", { name: "Revoke this ticket?" }),
  ).toBeDefined();
  await turned(() => {
    within(screen.getByRole("dialog"))
      .getByRole("button", { name: "Cancel" })
      .click();
  });
  expect(screen.queryByRole("dialog")).toBeNull();

  await turned(() => {
    within(inboxItemOf(7)).getByRole("button", { name: "reject" }).click();
  });
  expect(
    within(inboxItemOf(7)).getByRole("group", {
      name: "Reject this proposal?",
    }),
  ).toBeDefined();
  await turned(() => {
    within(inboxItemOf(11)).getByRole("button", { name: "Reject" }).click();
  });
  expect(
    within(inboxItemOf(11)).getByRole("group", {
      name: "Send this work back?",
    }),
  ).toBeDefined();
  expect(screen.queryByRole("dialog")).toBeNull();
});

/** The inbox read again on a frame naming ticket `resource`. */
async function rereadOn(
  server: ReturnType<typeof openedStream>,
  resource: number,
): Promise<void> {
  await turned(() => {
    server.push(
      frame("Ticket", "20", {
        version: 1,
        resource: String(resource),
        representation: { ...escalatedTicket(resource), phase: "Work" },
      }),
    );
  });
  await settled();
}

/** The answer pressed from the keyboard's place, as a reader's press leaves focus on it. */
async function answered(ticket: number): Promise<void> {
  const resume = within(inboxItemOf(ticket)).getByRole("button", {
    name: "resume",
  });
  resume.focus();
  await turned(() => {
    resume.click();
  });
}

test("once an answered item leaves, focus is on the next item of its group", async () => {
  let entries = [4, 5].map((ticket) => inboxEntry(escalatedTicket(ticket)));
  const { api, server } = drawInbox(() => entries);
  await settled();
  await answered(4);
  expect(api.submissions()).toBe(1);
  entries = entries.slice(1);
  await rereadOn(server, 4);
  expect(document.activeElement).toBe(
    within(inboxItemOf(5)).getByRole("link", {
      name: "Resume this ticket, or revoke it?",
    }),
  );
});

test("once the last answered item of a group leaves, focus is on the group's heading, and with nothing left on the clear line", async () => {
  let entries = [4, 5].map((ticket) => inboxEntry(escalatedTicket(ticket)));
  const { server } = drawInbox(() => entries);
  await settled();
  await answered(5);
  entries = entries.slice(0, 1);
  await rereadOn(server, 5);
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: /^Questions/u }),
  );

  await answered(4);
  entries = [];
  await rereadOn(server, 4);
  expect(document.activeElement?.textContent).toBe("Inbox is clear");
});

test("focus the reader took elsewhere is left there when an item leaves", async () => {
  let entries = [4, 5].map((ticket) => inboxEntry(escalatedTicket(ticket)));
  const { server } = drawInbox(() => entries);
  await settled();
  await answered(4);
  const elsewhere = document.body.appendChild(document.createElement("button"));
  elsewhere.focus();
  entries = entries.slice(1);
  await rereadOn(server, 4);
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});
