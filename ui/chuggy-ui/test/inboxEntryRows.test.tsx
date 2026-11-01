/**
 * A row whatever put its ticket in the inbox — an open action, a held proposal
 * or a refusal alone — drawn from the row its entry carries: its title, and its
 * last execution where one ran, with no read of the ticket on its own.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ticketLatestExecutionSchema } from "../../../src/contract/responses.ts";
import type {
  InboxEntryResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { inboxAnswered, inboxEntry } from "./inboxFixture.ts";
import {
  abilitiesAnswered,
  abilitiesEvery,
} from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
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

/** The run a ticket last held, which ended in a failure. */
const failedRun = ticketLatestExecutionSchema.parse({
  execution: "e11",
  ticket: 11,
  task: 1,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 11, cycle: 1 } },
  cluster: "rig",
  configurationRevision: "r1",
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "chuggy/worker",
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Terminal",
  outcome: "Failed",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
  terminalAt: "2026-08-26T10:30:00.000Z",
});

const proposed: ProjectTicket = {
  ticket: 7,
  title: "README: how changes land through chuggy",
  phase: "Pending",
  sequence: 5,
  ...ticketInstants,
};

const finalizing: ProjectTicket = {
  ticket: 11,
  title: "Land the release notes",
  phase: "Finalization",
  sequence: 6,
  latestExecution: failedRun,
  ...ticketInstants,
};

const refused: ProjectTicket = {
  ticket: 42,
  title: "Write the brief",
  phase: "Pending",
  sequence: 4,
  latestExecution: { ...failedRun, execution: "e42" },
  ...ticketInstants,
};

const approval: ProjectNativeActionResponse = {
  ticket: 11,
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

/** The inbox holding `entries`, every address it reads kept. */
function drawInbox(entries: readonly InboxEntryResponse[]): {
  readonly read: readonly string[];
} {
  const read: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    read.push(url);
    return Promise.resolve(
      abilitiesAnswered(url, abilitiesEvery) ??
        inboxAnswered(url, entries) ??
        answer({ partition: atlas, sequence: 9, tickets: [] }),
    );
  });
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return { read };
}

/** The row a ticket's number link sits in. */
function row(ticket: number): HTMLElement {
  const found = screen
    .getByRole("link", { name: String(ticket) })
    .closest("tr");
  if (found === null) throw new Error(`no row for ticket ${String(ticket)}`);
  return found;
}

/** One row's cell under the column the table names `column`. */
function cell(ticket: number, column: string): string {
  const columns = screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  const at = columns.indexOf(column);
  if (at < 0) throw new Error(`no column ${column}`);
  return row(ticket).children[at]?.textContent ?? "";
}

test("a ticket only an open action names draws its last execution", async () => {
  drawInbox([inboxEntry(finalizing, { actions: [approval] })]);
  await settled();
  expect(cell(11, "title")).toBe(`${finalizing.title ?? ""}11`);
  expect(cell(11, "last execution")).toContain("Failed");
  expect(cell(11, "last activity")).not.toBe("—");
  expect(within(row(11)).getByText("awaiting your approval")).toBeDefined();
});

test("a ticket only a refusal names draws its last execution", async () => {
  drawInbox([
    inboxEntry(refused, {
      refusals: [
        {
          ticket: 42,
          ticketVersion: 2,
          reason: "the brief names no reference",
          decision: "selector-decision-1",
          recordedAt: "2026-09-01T09:01:00Z",
          superseded: false,
        },
      ],
    }),
  ]);
  await settled();
  expect(cell(42, "title")).toBe(`${refused.title ?? ""}42`);
  expect(cell(42, "last execution")).toContain("Failed");
});

test("a proposed ticket's row names it, says it never ran, and offers the proposal's answers alone", async () => {
  drawInbox([
    inboxEntry(proposed, {
      proposals: [{ decision: "dec-one", tickets: [7] }],
    }),
  ]);
  await settled();
  expect(cell(7, "title")).toBe(`${proposed.title ?? ""}7`);
  expect(cell(7, "last execution")).toBe("—");
  expect(
    within(row(7))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toStrictEqual(["approve", "reject"]);
});

test("no ticket is read on its own, whatever put it in the inbox", async () => {
  const drawn = drawInbox([
    inboxEntry(finalizing, { actions: [approval] }),
    inboxEntry(proposed, {
      proposals: [{ decision: "dec-one", tickets: [7] }],
    }),
  ]);
  await settled();
  expect(drawn.read.filter((url) => /\/tickets\/\d+/u.test(url))).toStrictEqual(
    [],
  );
});
