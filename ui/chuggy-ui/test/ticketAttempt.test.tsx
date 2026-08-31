/**
 * What the actions panel says about an attempt it cannot see the end of: a
 * follow or a cancellation that threw rather than answered, a panel remounted
 * or navigated away from while one was still running, and an open-actions read
 * that has not come back.
 *
 * Each is a state the panel used to draw as though nothing had happened — a
 * swallowed rejection left it busy for ever, a cancellation the actor took left
 * the follow polling behind it, a remount replaced a running attempt with the
 * button that started it, a move to another ticket drew the first ticket's
 * attempt over the second, and an unread action list was drawn as the phase's
 * guess at what the actor admits.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { ticketAttemptKey } from "../app/core/ticketActions.ts";
import type { TicketAttempt } from "../app/core/ticketActions.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** The wait a case wants: held open for ever, thrown out of, or taken and
 * returned from, which is what lets a follow reach its next poll. */
const waiting = vi.hoisted<{ mode: "hold" | "throw" | "pass" }>(() => ({
  mode: "hold",
}));

/** What the actor says about the operation being followed, which a case moves
 * off `Pending` when it wants the follow to settle. */
const standing = vi.hoisted(() => ({ state: "Pending" }));

/** Which ticket the reader is on, which a case changes without unmounting —
 * `ticketRoute` carries no key, so the page is one instance across the move. */
const viewing = vi.hoisted(() => ({ ticket: "11" }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => {
    if (waiting.mode === "throw")
      return Promise.reject(new Error("the clock stopped"));
    if (waiting.mode === "hold") return new Promise<void>(() => undefined);
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: viewing.ticket }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  waiting.mode = "hold";
  standing.state = "Pending";
  viewing.ticket = "11";
  vi.unstubAllGlobals();
});

/** A ticket parked with a resume the machine stamped and the gas to pay it,
 * which is the one shape that offers a Resume the reader can press. */
function parkedAt(ticket: number): unknown {
  return {
    ticket,
    phase: "Escalated",
    sequence: 7,
    reason: "WorkFailed",
    resumeAt: "ResumeWorking",
    accounts: { gasLeft: 5, gasMax: 5, reworkLeft: 1 },
    ...ticketInstants,
  };
}

/** Whichever ticket the route being read names, so a move between tickets is
 * answered as itself rather than as the one the case started on. */
function ticketAsked(url: string): number {
  return Number(/\/tickets\/(\d+)/.exec(url)?.[1] ?? "11");
}

function operationAsked(url: string): string {
  return url.split("/operations/")[1] ?? "op-one";
}

interface Served {
  readonly urls: readonly string[];
  readonly posts: () => number;
  readonly fetch: typeof fetch;
}

/**
 * Every route the ticket page reads, with the two the cases differ in — what a
 * submission answers, and what the open-actions read does — left to them.
 */
function served(scripted: {
  readonly submission: () => Response;
  readonly openActions: () => Response;
  readonly cancellation?: () => Response;
}): Served {
  const urls: string[] = [];
  let posts = 0;
  const respond = (url: string, method: string | undefined): Response => {
    if (method === "POST") {
      posts += 1;
      return scripted.submission();
    }
    if (method === "DELETE") return (scripted.cancellation ?? deferred)();
    if (url.includes("/operations/"))
      return answer({
        operation: operationAsked(url),
        acceptedAt: "2026-08-26T10:00:00Z",
        state: standing.state,
      });
    if (url.includes("/native-actions")) return scripted.openActions();
    if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(parkedAt(ticketAsked(url)));
    return answer({
      partition: atlas,
      sequence: 7,
      tickets: [parkedAt(ticketAsked(url))],
    });
  };
  return {
    urls,
    posts: () => posts,
    fetch: ((url: string, init?: { readonly method?: string }) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(respond(url, init?.method));
    }) as unknown as typeof fetch,
  };
}

function page(client: QueryClient): ReactNode {
  return (
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>
  );
}

/** The page under its providers. A case remounts over the unmount, and moves
 * between tickets by re-rendering the same instance. */
function mounted(client: QueryClient): RenderResult {
  return render(page(client));
}

/** A move to another ticket, which is all `ticketRoute` does: the params
 * change and the same page instance is asked to draw again. */
async function navigated(
  view: RenderResult,
  client: QueryClient,
  ticket: string,
): Promise<void> {
  viewing.ticket = ticket;
  await turned(() => {
    view.rerender(page(client));
  });
}

/** A deferral with the wait the client is told to take before trying again. */
function deferred(): Response {
  return new Response(JSON.stringify({ error: { code: "Backlogged" } }), {
    status: 503,
    headers: { "content-type": nativeHttpMediaType, "retry-after": "1" },
  });
}

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

test("a follow that throws leaves the panel settled and says why", async () => {
  const api = served({
    submission: deferred,
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  mounted(new QueryClient());
  await settled();

  waiting.mode = "throw";
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(screen.getByText("the clock stopped")).toBeDefined();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
});

test("a panel remounted mid-follow picks the attempt back up", async () => {
  const api = accepting();
  const client = new QueryClient();
  const view = await following(api, client);

  await turned(view.unmount);
  mounted(client);
  await settled();

  expect(
    api.urls.some(
      (url) => url.startsWith("GET") && url.includes("/operations/op-one"),
    ),
  ).toBe(true);
  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(button("Cancel")).not.toBeNull();
  expect(api.posts()).toBe(1);
});

test("an unread action list offers nothing the phase alone would allow", async () => {
  const api = served({
    submission: () => answer({ operation: "op-one", state: "Pending" }, 202),
    openActions: () => answer({ error: { code: "Fault" } }, 500),
  });

  vi.stubGlobal("fetch", api.fetch);
  mounted(new QueryClient());
  await settled();

  expect(button("Resume")).toBeNull();
  expect(button("Revoke")).toBeNull();
  expect(screen.getByText(/^Failed to load · /)).toBeDefined();
});

/** An API that accepts the submission and leaves the operation pending, which
 * is the standing every case below drives a follow over. */
function accepting(cancellation?: () => Response): Served {
  return served({
    submission: () => answer({ operation: "op-one", state: "Pending" }, 202),
    openActions: () => answer({ actions: [] }),
    ...(cancellation === undefined ? {} : { cancellation }),
  });
}

/** The panel with an attempt parked at `Following`, which is where Cancel is
 * the only button there is. */
async function following(
  api: Served,
  client: QueryClient,
): Promise<RenderResult> {
  vi.stubGlobal("fetch", api.fetch);
  const view = mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();
  expect(button("Cancel")).not.toBeNull();
  return view;
}

test("a cancellation that throws is said rather than swallowed", async () => {
  await following(accepting(deferred), new QueryClient());

  waiting.mode = "throw";
  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(screen.getByText("Cancel refused · the clock stopped")).toBeDefined();
});

test("an accepted cancellation ends the attempt it was asked about", async () => {
  await following(
    accepting(() => answer({ operation: "op-one", state: "Cancelled" })),
    new QueryClient(),
  );

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(button("Cancel")).toBeNull();
  expect(screen.getByText("Resume cancelled")).toBeDefined();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
});

test("moving to another ticket leaves the first ticket's attempt behind", async () => {
  const client = new QueryClient();
  const view = await following(accepting(), client);

  await navigated(view, client, "12");
  await settled();

  expect(button("Cancel")).toBeNull();
  expect(screen.queryByText("Waiting for actor…")).toBeNull();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
});

test("the attempt held for the ticket arrived at is the one picked up", async () => {
  const api = accepting();
  vi.stubGlobal("fetch", api.fetch);
  const client = new QueryClient();
  client.setQueryData<TicketAttempt>(ticketAttemptKey(atlas, 12), {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket: 12 },
    },
    operation: "op-two",
  });
  const view = mounted(client);
  await settled();
  expect(button("Cancel")).toBeNull();

  await navigated(view, client, "12");
  await settled();

  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(
    api.urls.some(
      (url) => url.startsWith("GET") && url.includes("/operations/op-two"),
    ),
  ).toBe(true);
  expect(api.posts()).toBe(0);
});

test("a refused cancellation does not outlive the follow it was about", async () => {
  const api = accepting(() =>
    answer({ error: { code: "OperationTerminal" } }, 409),
  );
  waiting.mode = "pass";
  vi.stubGlobal("fetch", api.fetch);
  mounted(new QueryClient());
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await turned();

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await turned();
  expect(screen.getByText(/^Cancel refused · /)).toBeDefined();

  standing.state = "Cancelled";
  await settled();

  expect(screen.getByText("Resume cancelled")).toBeDefined();
  expect(screen.queryByText(/^Cancel refused · /)).toBeNull();
});
