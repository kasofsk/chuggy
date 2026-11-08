/**
 * Revoke on the ticket page, which ends the ticket for good: it is in the
 * header's menu, choosing it asks, and only the ask's own button submits. Every other action is still one
 * press, and a revoke the actor refuses reads as any refusal does.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode, Ref } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
  queryClientUnretried,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketHeaderMenuLabel } from "../app/browser/ticket/TicketHeaderMenu.tsx";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketPageEveryTab,
  ticketHeader,
  ticketHeaderMenuOpened,
} from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Whether the wait between polls ever ends: held, a follow stays in flight. */
const waiting = vi.hoisted(() => ({ held: true }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.held ? new Promise<void>(() => undefined) : Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly children?: ReactNode;
    readonly ref?: Ref<HTMLAnchorElement>;
  }) => (
    <a href="/" ref={props.ref}>
      {props.children}
    </a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  waiting.held = true;
  vi.unstubAllGlobals();
});

/** Parked with a resume the machine stamped, so the header leads with Resume
 * and holds Revoke in its menu. */
const escalated = {
  ticket: 11,
  phase: "Escalated",
  sequence: 7,
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  ...ticketInstants,
};

const refused = {
  operation: "op-one",
  acceptedAt: "2026-08-26T10:00:00Z",
  state: "Refused",
  refusedHead: 7,
  refusedLifecycleGeneration: 1,
  code: "TicketNotRevocable",
  refusal: { type: "TicketNotRevocable", value: 11 },
};

function routed(url: string): Response {
  if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
  if (url.includes("/native-actions")) return answer({ actions: [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/drafts/")) return answer({}, 404);
  if (url.includes("/tickets/")) return answer(escalated);
  return answer({ partition: atlas, sequence: 7, tickets: [escalated] });
}

/** The parked ticket's page, the abilities read answering as its other reads
 * do unless the case hands a `fetch` of its own over them. */
async function mounted(
  operation: unknown = operationAt("Pending"),
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<{
  readonly api: ApiDouble;
  readonly header: HTMLElement;
  readonly card: HTMLElement;
}> {
  const api = apiDouble({ operation, route: routed });
  vi.stubGlobal("fetch", over(api.fetch));
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={queryClientUnretried()}
      transport={openedStream().ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>,
  );
  await settled();
  return {
    api,
    header: ticketHeader(),
    card: screen.getByRole("status", { name: "Needs you" }),
  };
}

function asked(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Revoke this ticket?" });
}

/** The menu's Revoke, opened onto. */
async function revokeItem(): Promise<HTMLElement> {
  return within(await ticketHeaderMenuOpened()).getByRole("menuitem", {
    name: "Revoke…",
  });
}

async function revokePressed(): Promise<HTMLElement> {
  const item = await revokeItem();
  await turned(() => {
    item.click();
  });
  const group = asked();
  if (group === null) throw new Error("Revoke opened no ask");
  return group;
}

test("one press of Revoke sends nothing and asks what it ends", async () => {
  const { api, header } = await mounted();
  const group = await revokePressed();

  expect(api.submissions()).toBe(0);
  expect(group.textContent).toContain(
    "Ends this ticket and blocks its dependents. Can't be undone.",
  );
  expect(header.contains(group)).toBe(false);
});

test("Cancel sends nothing and gives the actions back as they were", async () => {
  const { api, header } = await mounted();
  const group = await revokePressed();

  await turned(() => {
    within(group).getByRole("button", { name: "Cancel" }).click();
  });

  expect(asked()).toBeNull();
  expect(api.submissions()).toBe(0);
  expect((await revokeItem()).hasAttribute("data-disabled")).toBe(false);
  expect(
    within(header)
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

test("Revoke ticket sends one revoke and closes the ask, and the menu's Revoke is busy while it is in flight", async () => {
  const { api } = await mounted();
  const group = await revokePressed();

  await turned(() => {
    within(group).getByRole("button", { name: "Revoke ticket" }).click();
  });
  await settled();

  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "RevokeTicket", ticket: 11 },
  });
  expect(asked()).toBeNull();
  expect((await revokeItem()).hasAttribute("data-disabled")).toBe(true);
});

test("every other action still sends on one press", async () => {
  const { api, header } = await mounted();

  await turned(() => {
    within(header).getByRole("button", { name: "Resume" }).click();
  });

  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "ResumeTicket", ticket: 11 },
  });
  expect(asked()).toBeNull();
});

test("an ask left for another button closes, and that button sends its own action alone", async () => {
  const { api, header } = await mounted();
  await revokePressed();

  const resume = within(header).getByRole("button", { name: "Resume" });
  await turned(() => {
    resume.focus();
  });
  expect(asked()).toBeNull();
  await turned(() => {
    resume.click();
  });

  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "ResumeTicket", ticket: 11 },
  });
});

test("a revoke the actor refuses closes the ask and says so where any refusal is said", async () => {
  waiting.held = false;
  const { header } = await mounted(refused);
  const group = await revokePressed();

  await turned(() => {
    within(group).getByRole("button", { name: "Revoke ticket" }).click();
  });
  await settled();

  expect(asked()).toBeNull();
  expect(within(header).getByText(/^Revoke refused · /u)).toBeDefined();
  expect((await revokeItem()).hasAttribute("data-disabled")).toBe(false);
});

async function parkedAnswers(): Promise<readonly boolean[]> {
  const resume = screen.queryByRole("button", { name: "Resume" }) !== null;
  const menu = screen.queryByRole("button", { name: ticketHeaderMenuLabel });
  const revoke =
    menu !== null &&
    within(await ticketHeaderMenuOpened()).queryByRole("menuitem", {
      name: "Revoke…",
    }) !== null;
  return [resume, revoke];
}

test("a reader who may not mutate reads why the ticket is parked and is offered neither Resume nor Revoke", async () => {
  const { card } = await mounted(
    undefined,
    abilitiesOver({ ...abilitiesEvery, mutate: false }),
  );
  expect(card.textContent).not.toBe("");
  expect(await parkedAnswers()).toStrictEqual([false, false]);
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Resume and Revoke",
  async (_said, abilities) => {
    await mounted(undefined, abilitiesOver(abilities));
    expect(await parkedAnswers()).toStrictEqual([true, true]);
  },
);
