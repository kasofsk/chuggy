/**
 * An item whatever put its ticket in the inbox — an open action or its phase
 * alone — drawn from the row its entry carries: its number and title, and its
 * last execution where one ran, with no read of the ticket on its own.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
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
import { inboxAnswered, inboxEntry, inboxItemOf } from "./inboxFixture.ts";
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

const escalated: ProjectTicket = {
  ticket: 11,
  title: "Land the release notes",
  phase: "Escalated",
  sequence: 6,
  latestExecution: failedRun,
  ...ticketInstants,
};

const phased: ProjectTicket = {
  ticket: 42,
  title: "Write the brief",
  phase: "Escalated",
  sequence: 4,
  latestExecution: { ...failedRun, execution: "e42" },
  ...ticketInstants,
};

const escalation: ProjectNativeActionResponse = {
  ticket: 11,
  action: "action-eleven",
  kind: "TicketEscalation",
  authorizingSequence: 51,
  admits: ["Resume", "Revoke"],
  answerable: true,
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
  renderCopied(
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

/** How an item says its ticket's last run ended, where it says so. */
function lastRun(ticket: number): string | undefined {
  return (
    within(inboxItemOf(ticket)).queryByText("last run")?.textContent ??
    undefined
  );
}

test("a ticket only an open action names draws its last execution", async () => {
  drawInbox([inboxEntry(escalated, { actions: [escalation] })]);
  await settled();
  expect(
    within(inboxItemOf(11)).getByText(`#11 ${escalated.title ?? ""}`),
  ).toBeDefined();
  expect(lastRun(11)).toBe("last run Failed");
  expect(inboxItemOf(11).textContent).not.toContain("—");
  expect(
    within(inboxItemOf(11))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toStrictEqual(["resume", "revoke"]);
});

test("a ticket only its phase names draws its last execution", async () => {
  drawInbox([inboxEntry(phased)]);
  await settled();
  expect(
    within(inboxItemOf(42)).getByText(`#42 ${phased.title ?? ""}`),
  ).toBeDefined();
  expect(lastRun(42)).toBe("last run Failed");
});

test("no ticket is read on its own, whatever put it in the inbox", async () => {
  const drawn = drawInbox([
    inboxEntry(escalated, { actions: [escalation] }),
    inboxEntry(phased),
  ]);
  await settled();
  expect(drawn.read.filter((url) => /\/tickets\/\d+/u.test(url))).toStrictEqual(
    [],
  );
});
