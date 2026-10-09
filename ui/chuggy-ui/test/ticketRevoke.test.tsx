/**
 * Revoke on the ticket page, which ends the ticket for good: the press asks,
 * and only the ask's own button submits. Every other action is still one
 * press, and a revoke the actor refuses reads as any refusal does.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
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
import type * as BrowserPorts from "../app/browser/ports.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

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
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
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

/** Parked with a resume the machine stamped, so Resume is drawn in the card
 * and Revoke in the bar. */
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
  readonly bar: HTMLElement;
  readonly card: HTMLElement;
}> {
  const api = apiDouble({ operation, route: routed });
  vi.stubGlobal("fetch", over(api.fetch));
  const { container } = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  const bar = container.querySelector<HTMLElement>(".ticket-status");
  if (bar === null) throw new Error("no status bar drawn");
  return { api, bar, card: screen.getByRole("status", { name: "Needs you" }) };
}

function asked(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Revoke this ticket?" });
}

async function revokePressed(bar: HTMLElement): Promise<HTMLElement> {
  await turned(() => {
    within(bar).getByRole("button", { name: "Revoke" }).click();
  });
  const group = asked();
  if (group === null) throw new Error("Revoke opened no ask");
  return group;
}

test("one press of Revoke sends nothing and asks what it ends", async () => {
  const { api, bar } = await mounted();
  const group = await revokePressed(bar);

  expect(api.submissions()).toBe(0);
  expect(group.textContent).toContain(
    "Ends this ticket and parks its dependents. Can't be undone.",
  );
  expect(
    within(bar)
      .getByRole("button", { name: "Revoke" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});

test("Cancel sends nothing and gives the actions back as they were", async () => {
  const { api, bar, card } = await mounted();
  const group = await revokePressed(bar);

  await turned(() => {
    within(group).getByRole("button", { name: "Cancel" }).click();
  });

  expect(asked()).toBeNull();
  expect(api.submissions()).toBe(0);
  const revoke = within(bar).getByRole("button", { name: "Revoke" });
  expect(revoke.getAttribute("aria-expanded")).toBe("false");
  expect(revoke.hasAttribute("disabled")).toBe(false);
  expect(
    within(card)
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

test("Revoke ticket sends one revoke, and the ask stays busy while it is in flight", async () => {
  const { api, bar } = await mounted();
  const group = await revokePressed(bar);

  await turned(() => {
    within(group).getByRole("button", { name: "Revoke ticket" }).click();
  });
  await settled();

  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "RevokeTicket", ticket: 11 },
  });
  const busy = asked();
  if (busy === null)
    throw new Error("the ask closed while its revoke was sent");
  const confirm = within(busy).getByRole("button", { name: "Revoke ticket" });
  expect(confirm.getAttribute("aria-busy")).toBe("true");
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(within(busy).queryByRole("button", { name: "Cancel" })).toBeNull();
});

test("every other action still sends on one press", async () => {
  const { api, card } = await mounted();

  await turned(() => {
    within(card).getByRole("button", { name: "Resume" }).click();
  });

  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "ResumeTicket", ticket: 11 },
  });
  expect(asked()).toBeNull();
});

test("a submission from another button closes an ask left open", async () => {
  const { api, bar, card } = await mounted();
  await revokePressed(bar);

  await turned(() => {
    within(card).getByRole("button", { name: "Resume" }).click();
  });

  expect(api.submissions()).toBe(1);
  expect(asked()).toBeNull();
});

test("a revoke the actor refuses closes the ask and says so where any refusal is said", async () => {
  waiting.held = false;
  const { bar } = await mounted(refused);
  const group = await revokePressed(bar);

  await turned(() => {
    within(group).getByRole("button", { name: "Revoke ticket" }).click();
  });
  await settled();

  expect(asked()).toBeNull();
  expect(within(bar).getByText(/^Revoke refused · /u)).toBeDefined();
  expect(
    within(bar)
      .getByRole("button", { name: "Revoke" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

function parkedAnswers(): readonly boolean[] {
  return ["Resume", "Revoke"].map(
    (name) => screen.queryByRole("button", { name }) !== null,
  );
}

test("a reader who may not mutate reads why the ticket is parked and is offered neither Resume nor Revoke", async () => {
  const { card } = await mounted(
    undefined,
    abilitiesOver({ ...abilitiesEvery, mutate: false }),
  );
  expect(card.textContent).not.toBe("");
  expect(parkedAnswers()).toStrictEqual([false, false]);
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Resume and Revoke",
  async (_said, abilities) => {
    await mounted(undefined, abilitiesOver(abilities));
    expect(parkedAnswers()).toStrictEqual([true, true]);
  },
);
