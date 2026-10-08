/**
 * An escalated ticket's overrides changed from the card that asks about it:
 * closed until asked for, limited to what the contract says a parked ticket may
 * change, saved and followed on their own, and Resume withheld while what was
 * typed is not yet what the ticket holds.
 *
 * The server here is a double that keeps the ticket: a change it answers
 * becomes the overrides the ticket's read carries, and a resume moves the
 * ticket back to work at the next sequence, so what the page draws after each
 * press is what it read back rather than what it was told.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
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

import type { ConfigurationOverrides } from "../../../src/contract/configurationOverrides.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => props.children,
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Read at build time by Vite, since `.chug/` is a dot directory a glob skips unless told. */
const declarations = import.meta.glob<string>(
  "../../../.chug/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);
const sonnetRaw =
  declarations["../../../.chug/configurations/chuggy-development-sonnet.json"];
if (sonnetRaw === undefined)
  throw new Error("no chuggy-development-sonnet configuration declared");
const canonical = JSON.stringify(
  (JSON.parse(sonnetRaw) as { readonly configuration: unknown }).configuration,
);
const revision = "r-sonnet-1";

const escalation = {
  action: "action-parked",
  kind: "TicketEscalation",
  authorizingSequence: 7,
  admits: ["Resume", "Revoke"],
};

/** What a change is answered with: taken, or refused under a boundary code. */
type ChangeAnswer = "Answered" | "OverridesMoveDefinition";

interface Served {
  readonly posted: unknown[];
  readonly changes: () => number;
}

/** What the double holds of the one ticket, which the presses move. */
interface Kept {
  readonly kind: string;
  readonly changed: ChangeAnswer;
  readonly posted: Record<string, unknown>[];
  overrides: ConfigurationOverrides | undefined;
  phase: string;
  sequence: number;
}

function keptTicket(kept: Kept): unknown {
  return {
    ticket: 11,
    phase: kept.phase,
    sequence: kept.sequence,
    ...ticketInstants,
    configurationRevision: revision,
    ...(kept.phase === "Escalated"
      ? { escalation: { kind: kept.kind, resumeAt: "ResumeWork" } }
      : {}),
    ...(kept.overrides === undefined ? {} : { overrides: kept.overrides }),
  };
}

/** How the last submission settled: a resume journals, and a change is answered or refused. */
function keptOperation(kept: Kept): unknown {
  const identity = {
    operation: `op-${String(kept.posted.length)}`,
    acceptedAt: "2026-08-26T10:00:00Z",
  };
  const last = kept.posted[kept.posted.length - 1];
  if (last?.["mutation"] !== "ChangeTicketOverrides")
    return { ...identity, state: "Succeeded", decidedSequence: 8 };
  return kept.changed === "Answered"
    ? { ...identity, state: "Answered" }
    : {
        ...identity,
        state: "Refused",
        refusedHead: 7,
        refusedLifecycleGeneration: 1,
        code: kept.changed,
      };
}

/** One submission taken: a change the double answers becomes what the ticket holds, and a resume moves it to work. */
function keptPosted(kept: Kept, body: string | undefined): Response {
  const mutation = (
    JSON.parse(body ?? "null") as { mutation: Record<string, unknown> }
  ).mutation;
  kept.posted.push(mutation);
  if (mutation["mutation"] !== "ChangeTicketOverrides") {
    kept.phase = "Work";
    kept.sequence = 8;
  } else if (kept.changed === "Answered")
    kept.overrides = mutation["overrides"] as ConfigurationOverrides;
  return answer(
    { operation: `op-${String(kept.posted.length)}`, state: "Pending" },
    202,
  );
}

function keptRoute(
  kept: Kept,
  url: string,
  init?: { method?: string; body?: string },
): Response {
  if (init?.method === "POST") return keptPosted(kept, init.body);
  if (url.includes("/operations/")) return answer(keptOperation(kept));
  if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
  if (url.includes("/native-actions"))
    return answer({ actions: kept.phase === "Escalated" ? [escalation] : [] });
  if (url.includes("/executions")) return answer({ executions: [] });
  if (url.includes("/drafts/")) return answer({}, 404);
  if (url.includes("/configurations/"))
    return answer({
      partition: atlas,
      revision,
      canonical,
      digest: "d".repeat(64),
    });
  if (url.includes("/tickets/")) return answer(keptTicket(kept));
  return answer({
    partition: atlas,
    sequence: kept.sequence,
    tickets: [keptTicket(kept)],
  });
}

/** A server keeping one ticket parked at `kind` until a resume moves it. */
function serving(
  kind: string,
  changed: ChangeAnswer = "Answered",
  held?: ConfigurationOverrides,
): Served {
  const kept: Kept = {
    kind,
    changed,
    posted: [],
    overrides: held,
    phase: "Escalated",
    sequence: 7,
  };
  vi.stubGlobal(
    "fetch",
    (url: string, init?: { method?: string; body?: string }) =>
      Promise.resolve(keptRoute(kept, url, init)),
  );
  return {
    posted: kept.posted,
    changes: () =>
      kept.posted.filter(
        (mutation) => mutation["mutation"] === "ChangeTicketOverrides",
      ).length,
  };
}

async function drawn(): Promise<HTMLElement> {
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  return screen.getByRole("status", { name: "Needs you" });
}

async function overridesOpened(card: HTMLElement): Promise<void> {
  await turned(() => {
    within(card)
      .getByRole("button", { name: /^Overrides/u })
      .click();
  });
  await settled();
}

async function modelTyped(card: HTMLElement, model: string): Promise<void> {
  await turned(() => {
    fireEvent.change(within(card).getByLabelText(/^Model/u), {
      target: { value: model },
    });
  });
}

async function pressed(card: HTMLElement, name: string): Promise<void> {
  await turned(() => {
    within(card).getByRole("button", { name }).click();
  });
  await settled();
}

test("the card's overrides are closed until asked for, and draw only what a parked ticket may change", async () => {
  serving("WorkFailureEscalated");
  const card = await drawn();
  expect(within(card).queryByLabelText(/^Model/u)).toBeNull();
  await overridesOpened(card);
  expect(within(card).getByLabelText(/^Model/u)).toBeDefined();
  expect(within(card).getByText("Setup")).toBeDefined();
  expect(within(card).queryByText("Work instructions")).toBeNull();
  expect(within(card).getByRole("button", { name: "Resume" })).toBeDefined();
});

test("a member changes the model, saves, resumes, and the page draws the new model as overridden", async () => {
  const served = serving("WorkFailureEscalated");
  const card = await drawn();
  await overridesOpened(card);
  await modelTyped(card, "opus");
  expect(within(card).queryByRole("button", { name: "Resume" })).toBeNull();

  await pressed(card, "Save overrides");
  expect(served.posted[0]).toEqual({
    mutation: "ChangeTicketOverrides",
    ticket: 11,
    action: "action-parked",
    authorizingSequence: 7,
    overrides: {
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Claude",
          arguments: [
            "--allowedTools=Bash,Edit,Read,Write,Glob,Grep",
            "--model=opus",
          ],
        },
      },
    },
  });
  expect(card.textContent).toContain("Overrides saved");

  await pressed(card, "Resume");
  expect(served.posted[1]).toEqual({
    mutation: "ResolveNativeAction",
    action: "action-parked",
    authorizingSequence: 7,
    resolution: "Resume",
  });
  expect(screen.queryByRole("status", { name: "Needs you" })).toBeNull();

  await turned(() => {
    screen.getByRole("button", { name: /^Provenance/u }).click();
  });
  await settled();
  const model = screen.getByText("--model=opus");
  expect(model.closest("div")?.textContent).toContain("Overridden");
});

test("a refused change is drawn on the card, holding what was typed, and Resume stays withheld", async () => {
  const served = serving("WorkFailureEscalated", "OverridesMoveDefinition");
  const card = await drawn();
  await overridesOpened(card);
  await modelTyped(card, "opus");
  await pressed(card, "Save overrides");
  expect(served.changes()).toBe(1);
  expect(card.textContent).toContain(
    "Not saved · Overrides would change the definition",
  );
  expect(within(card).getByLabelText<HTMLInputElement>(/^Model/u).value).toBe(
    "opus",
  );
  expect(within(card).queryByRole("button", { name: "Resume" })).toBeNull();

  await pressed(card, "Discard");
  expect(within(card).getByRole("button", { name: "Resume" })).toBeDefined();
});

test("a change keeps an override the card does not draw, as the ticket holds it", async () => {
  const instructions = { work: { instructions: ["Do the held work."] } };
  const served = serving("WorkFailureEscalated", "Answered", instructions);
  const card = await drawn();
  await overridesOpened(card);
  await modelTyped(card, "opus");
  await pressed(card, "Save overrides");
  expect(served.posted[0]).toMatchObject({
    overrides: { ...instructions, worker: { mode: { agent: "Claude" } } },
  });
});

test("a ticket parked at its finalization is offered no overrides, its resume starting no worker", async () => {
  serving("FinalizationUnavailableEscalated");
  const card = await drawn();
  expect(
    within(card).queryByRole("button", { name: /^Overrides/u }),
  ).toBeNull();
  expect(within(card).getByRole("button", { name: "Resume" })).toBeDefined();
});
