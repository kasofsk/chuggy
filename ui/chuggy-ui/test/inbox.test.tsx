/**
 * The one property the inbox screen owns that no pure function can express: an
 * answered row stays until the project says it moved.
 *
 * The core has no seam for the answer path — the click, the follow and the
 * cache are shell code by construction — so this is the lowest tier that can
 * express it, and the providers are `screenHarness.tsx`'s. The operation stays
 * pending, so the row is looked at while its answer is still in flight.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { leadRefusals } from "./leadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Whether the wait between polls ever ends: held, a follow stays in flight. */
const waiting = vi.hoisted(() => ({ held: false }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.held ? new Promise<void>(() => undefined) : Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));

beforeEach(resizeObserverStubbed);

/** The stubbed global goes back whatever a case did with it, including a case
 * that stops partway; the rendered tree is torn down here rather than by the
 * library's own hook, which this runner has no global `afterEach` for. */
afterEach(() => {
  cleanup();
  waiting.held = false;
  vi.unstubAllGlobals();
});

const escalated = {
  ticket: 4,
  title: "Serve the reason",
  phase: "Escalated",
  sequence: 9,
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  ...ticketInstants,
};

const working = {
  ticket: 4,
  phase: "Work",
  sequence: 11,
  ...ticketInstants,
};

/** One escalated ticket, nothing else open, and nothing that has run. */
function served(url: string): Response {
  if (url.includes("/agentic-refusals"))
    return answer({ refusals: [], more: false });
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/selector-proposals"))
    return answer({ proposals: [], more: false });
  return answer({ partition: atlas, sequence: 9, tickets: [escalated] });
}

/** The same project with a ticket the lead is refusing to dispatch, which no
 * phase the section holds and no open question would ever find. */
function servedWithRefusal(url: string): Response {
  if (url.includes("/agentic-refusals")) return answer(leadRefusals(false));
  return served(url);
}

function drawInbox(route: (url: string) => Response): ApiDouble {
  const api = apiDouble({ operation: operationAt("Pending"), route });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return api;
}

test("a row names the ticket it is about beside its number", async () => {
  drawInbox(served);
  expect(await screen.findByText("Serve the reason")).toBeDefined();
});

test("an answered row stays until a Ticket frame moves it out of the section", async () => {
  const api = apiDouble({ operation: operationAt("Pending"), route: served });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
  expect(screen.getByRole("button", { name: "resume" })).toBeDefined();

  await turned(() => {
    screen.getByRole("button", { name: "resume" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(
    screen.queryByRole("button", { name: "resume" }),
    "the answered row left the inbox before a frame said the ticket had moved",
  ).not.toBeNull();
  expect(screen.queryByText("Inbox is clear")).toBeNull();

  await turned(() => {
    server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: working,
      }),
    );
  });
  expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});

/** Revoke ends the ticket for good, so a row asks before it sends one: the
 * press and Cancel send nothing, and the ask stays, busy, once it has. */
test("revoke asks before it is sent, and only the ask's own button sends it", async () => {
  waiting.held = true;
  const api = drawInbox(served);
  await settled();
  const ask = (): HTMLElement | null =>
    screen.queryByRole("group", { name: "Revoke this ticket?" });

  await turned(() => {
    screen.getByRole("button", { name: "revoke" }).click();
  });
  const group = ask();
  if (group === null) throw new Error("revoke opened no ask");
  expect(api.submissions()).toBe(0);
  await turned(() => {
    within(group).getByRole("button", { name: "Cancel" }).click();
  });
  expect(ask()).toBeNull();
  expect(api.submissions()).toBe(0);

  await turned(() => {
    screen.getByRole("button", { name: "revoke" }).click();
  });
  await turned(() => {
    screen.getByRole("button", { name: "Revoke ticket" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "RevokeTicket", ticket: 4 },
  });
  expect(
    screen
      .getByRole("button", { name: "Revoke ticket" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("the top bar names how many the inbox holds", async () => {
  drawInbox(served);
  await settled();
  const count = screen.getByRole("heading", {
    name: "Inbox",
  }).nextElementSibling;
  expect(count?.textContent).toBe("1");
});

test("an answer's button still opens the sentence it sends", async () => {
  drawInbox(served);
  await settled();
  const button = screen.getByRole("button", { name: "resume" });
  const trigger = button.closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around resume");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "rejoin the pipeline at the point this ticket was parked at",
  );
});

/**
 * The inbox's fourth member on screen. A refused ticket keeps its phase and has
 * no open question behind it, so the row is drawn from the refusal alone and
 * the reason it names is what the reader came for.
 */
test("a ticket the lead refused is a row of its own, marked and reasoned", async () => {
  drawInbox(servedWithRefusal);
  await settled();
  expect(screen.getByRole("link", { name: "42" })).toBeDefined();
  const trigger = screen.getByText("Standing").closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Standing");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "the brief names no reference",
  );
});

/** The served policy refuses `style-src` but `'self'`, so nothing this screen
 * draws — a tooltip open included — may append a runtime style element. */
test("nothing the inbox screen draws is a runtime style element", async () => {
  drawInbox(servedWithRefusal);
  await settled();
  expect(document.querySelectorAll("style").length).toBe(0);
  const trigger = screen.getByText("Standing").closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Standing");
  fireEvent.focus(trigger);
  await screen.findByRole("tooltip");
  expect(document.querySelectorAll("style").length).toBe(0);
});

/** The run the escalated ticket last held, which has ended in a failure. */
const failedRun = {
  execution: "e4",
  ticket: 4,
  task: 1,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 4, cycle: 1 } },
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
};

test("a row says how its last run ended, and never Terminal", async () => {
  drawInbox((url) =>
    url.includes("/executions")
      ? answer({ executions: [failedRun] })
      : served(url),
  );
  await settled();
  expect(screen.getByText("Failed").className).toContain("pill-fail");
  expect(document.body.textContent).not.toContain("Terminal");
});
