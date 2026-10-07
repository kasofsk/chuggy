/**
 * A parked ticket's overrides on the card that asks about it: changed, saved
 * and followed to settlement, with Resume waiting while a change is unsaved,
 * and the page drawing what the ticket then holds.
 *
 * The configuration is the sonnet one this repository declares, so the model
 * the card writes is written the way that configuration says its own.
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

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  openedStream,
  operationAt,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

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
  action: "action-escalated",
  kind: "TicketEscalation",
  authorizingSequence: 52,
  admits: ["Resume", "Revoke"],
};

/** What the server holds and answers, changed by what the page submits. */
interface Served {
  overrides: unknown;
  readonly kind: string;
  readonly changeAnswered: unknown;
}

function ticketRead(served: Served): unknown {
  return {
    ticket: 11,
    phase: "Escalated",
    sequence: 52,
    escalation: {
      kind: served.kind,
      resumeAt:
        served.kind === "FinalizationUnavailableEscalated"
          ? "ResumeFinalization"
          : "ResumeWork",
    },
    ...ticketInstants,
    configurationRevision: revision,
    configurationVersion: { name: "chuggy-development-sonnet", number: 1 },
    ...(served.overrides === undefined ? {} : { overrides: served.overrides }),
  };
}

/** The mutation a submission carried, where it was one. */
function mutationOf(request: SentRequest): Record<string, unknown> | undefined {
  const body = request.body as { readonly mutation?: unknown } | undefined;
  return body?.mutation as Record<string, unknown> | undefined;
}

function answering(served: Served): (request: SentRequest) => Response {
  let operation: unknown = operationAt("Pending");
  return (request) => {
    const url = request.url;
    if (request.method === "POST") {
      const mutation = mutationOf(request);
      if (mutation?.["mutation"] === "ChangeTicketOverrides") {
        operation = served.changeAnswered;
        if (
          (served.changeAnswered as { readonly state: string }).state ===
          "Answered"
        )
          served.overrides = mutation["overrides"];
      } else operation = operationAt("Pending");
      return answer({ operation: "op-one", state: "Pending" }, 202);
    }
    if (url.includes("/operations/")) return answer(operation);
    if (url.includes("/dispatch-view"))
      return answer({ result: "Stale", reason: "TokenStale" });
    if (url.includes("/native-actions"))
      return answer({ actions: [escalation] });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/configurations/"))
      return answer({
        partition: atlas,
        revision,
        canonical,
        digest: "d".repeat(64),
      });
    if (url.includes("/drafts/")) return answer({}, 404);
    return answer(ticketRead(served));
  };
}

async function drawn(
  served: Served,
): Promise<{ readonly sent: readonly SentRequest[] }> {
  const scripted = scriptedFetch(answering(served));
  vi.stubGlobal("fetch", scripted.fetch);
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
  return { sent: scripted.sent };
}

function card(): HTMLElement {
  return screen.getByRole("status", { name: "Needs you" });
}

async function pressed(name: string, region: HTMLElement): Promise<void> {
  await turned(() => {
    within(region).getByRole("button", { name }).click();
  });
  await settled();
}

async function modelTyped(model: string): Promise<void> {
  await pressed("Change overrides before resuming", card());
  await turned(() => {
    fireEvent.change(within(card()).getByLabelText(/^Model/u), {
      target: { value: model },
    });
  });
}

function submitted(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((request) => request.method === "POST")
    .map((request) => mutationOf(request)?.["mutation"]);
}

test("a member changes the model, saves, resumes, and the page draws the new model as overridden", async () => {
  const served: Served = {
    overrides: undefined,
    kind: "WorkFailureEscalated",
    changeAnswered: operationAt("Answered"),
  };
  const { sent } = await drawn(served);
  expect(within(card()).queryByLabelText(/^Model/u)).toBeNull();
  await modelTyped("opus");
  const resume = within(card()).getByRole("button", { name: "Resume" });
  expect(resume.hasAttribute("disabled")).toBe(true);
  expect(card().textContent).toContain("Save or discard the overrides first");

  await pressed("Save overrides", card());
  const change = sent.find(
    (request) => mutationOf(request)?.["mutation"] === "ChangeTicketOverrides",
  );
  expect(mutationOf(change as SentRequest)).toMatchObject({
    ticket: 11,
    action: "action-escalated",
    authorizingSequence: 52,
    overrides: {
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Claude",
          arguments: expect.arrayContaining(["--model=opus"]) as unknown,
        },
      },
    },
  });
  expect(card().textContent).toContain("Overrides saved");
  expect(
    within(card())
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(false);

  await pressed("Resume", card());
  expect(submitted(sent)).toEqual([
    "ChangeTicketOverrides",
    "ResolveNativeAction",
  ]);

  await turned(() => {
    screen.getByRole("button", { name: /^Provenance/u }).click();
  });
  await settled();
  const model = screen
    .getAllByText("Model")
    .map((one) => one.closest(".ticket-config-cell"))
    .find((one) => one instanceof HTMLElement);
  expect(model).toBeInstanceOf(HTMLElement);
  expect(within(model as HTMLElement).getByText("Opus")).toBeDefined();
  expect(within(model as HTMLElement).getByText("Overridden")).toBeDefined();
});

test("a refused change is drawn on the card with what was typed still held, and Resume still waits", async () => {
  const served: Served = {
    overrides: undefined,
    kind: "WorkFailureEscalated",
    changeAnswered: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Refused",
      refusedHead: 52,
      refusedLifecycleGeneration: 1,
      code: "TicketChanged",
    },
  };
  await drawn(served);
  await modelTyped("opus");
  await pressed("Save overrides", card());
  expect(card().textContent).toContain(
    "Not saved · the ticket changed after this was submitted",
  );
  expect(within(card()).getByLabelText(/^Model/u)).toHaveProperty(
    "value",
    "opus",
  );
  expect(
    within(card())
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("discarding a typed change gives Resume back and sends nothing", async () => {
  const { sent } = await drawn({
    overrides: undefined,
    kind: "WorkFailureEscalated",
    changeAnswered: operationAt("Answered"),
  });
  await modelTyped("opus");
  await pressed("Discard", card());
  expect(
    within(card())
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(submitted(sent)).toEqual([]);
});

test("a ticket whose resume starts no worker is offered no overrides", async () => {
  await drawn({
    overrides: undefined,
    kind: "FinalizationUnavailableEscalated",
    changeAnswered: operationAt("Answered"),
  });
  expect(within(card()).getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    within(card()).queryByRole("button", {
      name: "Change overrides before resuming",
    }),
  ).toBeNull();
});
