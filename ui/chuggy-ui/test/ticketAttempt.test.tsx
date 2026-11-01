/**
 * What the actions panel says about an attempt it cannot see the end of: a
 * follow or a cancellation that threw rather than answered, a panel remounted
 * or navigated away from with one still in flight, and an open-actions read
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
import type { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  ticketLandedNowhere,
  ticketLandingsNone,
  turned,
  queryClientUnretried,
} from "./screenHarness.tsx";
import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { consoleWriteUnseenOf } from "../app/browser/consoleWriteUnseen.ts";
import type { ConsoleStore } from "../app/browser/store.ts";
import {
  ticketAttemptAt,
  ticketAttemptHeldAt,
} from "../app/browser/ticketAttempts.ts";
import type { TicketAttempt } from "../app/core/ticketActions.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { readFailedLines } from "./readFailedLines.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

/**
 * The wait a case wants: held open for ever, thrown out of, or released one at
 * a time by the case. A follow left to run on its own clock takes as many polls
 * per turn as the machine allows and can spend its whole budget inside one, so
 * a case that needs the follow to move says how far.
 */
const waiting = vi.hoisted<{
  mode: "hold" | "throw" | "step";
  readonly waiters: (() => void)[];
}>(() => ({ mode: "hold", waiters: [] }));

/** What the actor says about the operation being followed: which state it is
 * in, and whether the API has heard of it at all. */
const standing = vi.hoisted(() => ({ state: "Pending", known: true }));

/** A decision the ticket's read has not reached, which holds a follow that
 * hears it at `Confirming`. */
const decidedSequenceAhead = 99;

/** Which ticket the reader is on, which a case changes without unmounting —
 * `ticketRoute` carries no key, so the page is one instance across the move. */
const viewing = vi.hoisted(() => ({ ticket: "11" }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => {
    if (waiting.mode === "throw")
      return Promise.reject(new Error("the clock stopped"));
    if (waiting.mode === "hold") return new Promise<void>(() => undefined);
    return new Promise<void>((resolve) => waiting.waiters.push(resolve));
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
  waiting.waiters.length = 0;
  standing.state = "Pending";
  standing.known = true;
  viewing.ticket = "11";
  vi.unstubAllGlobals();
});

/** A ticket parked with a resume the machine stamped, which is the one shape
 * that offers a Resume the reader can press. */
function parkedAt(ticket: number): unknown {
  return {
    ticket,
    phase: "Escalated",
    sequence: 7,
    escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
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

/** As much of a request as the cases read: the console's own fetch port hands
 * the body over as text. */
interface Sent {
  readonly method?: string;
  readonly body?: string;
}

interface Served {
  readonly urls: readonly string[];
  readonly posts: () => number;
  /** Every operation identity the console has named, submitted or polled. A
   * second one is a second attempt, which is the thing a pick-up must not
   * make. */
  readonly identities: () => readonly string[];
  readonly fetch: typeof fetch;
}

/**
 * Every route the ticket page reads, with the two the cases differ in — what a
 * submission answers, and what the open-actions read does — left to them.
 */
function served(scripted: {
  readonly submission: (operation: string) => Response | Promise<Response>;
  readonly openActions: () => Response | Promise<Response>;
  readonly cancellation?: (operation: string) => Response | Promise<Response>;
}): Served {
  const urls: string[] = [];
  const identities = new Set<string>();
  let posts = 0;
  const respond = (
    url: string,
    init: Sent | undefined,
  ): Response | Promise<Response> => {
    const method = init?.method;
    if (method === "POST") {
      posts += 1;
      const submitted: unknown = JSON.parse(init?.body ?? "null");
      const operation = submissionIdentity(submitted);
      identities.add(operation);
      return scripted.submission(operation);
    }
    if (method === "DELETE") {
      const operation = operationAsked(url);
      identities.add(operation);
      return scripted.cancellation === undefined
        ? deferred()
        : scripted.cancellation(operation);
    }
    if (url.includes("/operations/")) {
      identities.add(operationAsked(url));
      if (!standing.known) return answer({ error: { code: "Absent" } }, 404);
      return answer({
        operation: operationAsked(url),
        acceptedAt: "2026-08-26T10:00:00Z",
        state: standing.state,
        ...(standing.state === "Succeeded"
          ? { decidedSequence: decidedSequenceAhead }
          : {}),
      });
    }
    if (url.includes("/native-actions")) return scripted.openActions();
    if (url.includes("/action-reach")) return answer(ticketLandedNowhere);
    if (url.includes("/landings")) return answer(ticketLandingsNone);
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
    identities: () => [...identities],
    fetch: ((url: string, init?: Sent) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(respond(url, init));
    }) as unknown as typeof fetch,
  };
}

/** The identity the console drew for a submission, which the route takes as
 * both the operation's name and its idempotency key. */
function submissionIdentity(body: unknown): string {
  const named =
    body !== null && typeof body === "object" && "operation" in body
      ? (body as { readonly operation: unknown }).operation
      : undefined;
  return typeof named === "string" ? named : "unnamed";
}

/** The store of the tab a client is of, made beside it as `main.tsx` makes
 * one beside the other, so a remount over the same client is the same tab. */
const tabStores = new WeakMap<QueryClient, ConsoleStore>();

function tabStoreOf(client: QueryClient): ConsoleStore {
  const standing = tabStores.get(client);
  if (standing !== undefined) return standing;
  const store = consoleStoreBare(client);
  tabStores.set(client, store);
  return store;
}

function attemptHeld(
  client: QueryClient,
  ticket: number,
  attempt: TicketAttempt,
): void {
  tabStoreOf(client).dispatch(
    ticketAttemptHeldAt({ partition: atlas, ticket, attempt }),
  );
}

function attemptRead(
  client: QueryClient,
  ticket: number,
): TicketAttempt | undefined {
  return ticketAttemptAt(tabStoreOf(client).getState(), atlas, ticket);
}

function page(client: QueryClient): ReactNode {
  return (
    <ScreenHarness
      partition={atlas}
      client={client}
      store={tabStoreOf(client)}
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

/** A response the case holds open, for the window between a request leaving
 * and its answer arriving. */
function held(): {
  readonly answering: Promise<Response>;
  readonly answer: (response: Response) => void;
} {
  let settle: (response: Response) => void = () => undefined;
  const answering = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { answering, answer: settle };
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

/** A read of one operation, which is what a pick-up makes before anything
 * else. */
function polling(url: string): boolean {
  return url.startsWith("GET") && url.includes("/operations/");
}

/** One more turn of a stepped follow: every wait standing is released, and a
 * follow registers exactly one before each request it makes. */
async function stepped(): Promise<void> {
  await turned(() => {
    for (const release of waiting.waiters.splice(0)) release();
  });
  await settled();
}

test("a follow that throws leaves the panel settled and says why", async () => {
  const api = served({
    submission: deferred,
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  mounted(queryClientUnretried());
  await settled();

  waiting.mode = "throw";
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(document.body.textContent).not.toContain("the clock stopped");
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
  fireEvent.focus(screen.getByText("Failed"));
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "the clock stopped",
  );
});

test("a panel remounted mid-follow draws the follow that kept running", async () => {
  const api = accepting();
  const client = queryClientUnretried();
  const view = await following(api, client);

  await turned(view.unmount);
  mounted(client);
  await settled();

  expect(api.urls.filter(polling)).toEqual([]);
  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(button("Cancel")).not.toBeNull();
  expect(api.posts()).toBe(1);
  expect(api.identities()).toHaveLength(1);
});

test("an unread action list offers nothing the phase alone would allow", async () => {
  const api = served({
    submission: (operation) => answer({ operation, state: "Pending" }, 202),
    openActions: () => answer({ error: { code: "Fault" } }, 500),
  });

  vi.stubGlobal("fetch", api.fetch);
  mounted(queryClientUnretried());
  await settled();

  expect(button("Resume")).toBeNull();
  expect(button("Revoke")).toBeNull();
  expect(readFailedLines()).toStrictEqual(["Not read · Server error"]);
});

/** An API that accepts the submission and leaves the operation pending, which
 * is the standing every case below drives a follow over. */
function accepting(
  cancellation?: (operation: string) => Response | Promise<Response>,
): Served {
  return served({
    submission: (operation) => answer({ operation, state: "Pending" }, 202),
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

test("a resume pressed in the card is followed in the bar, which holds its own buttons too", async () => {
  const api = accepting();
  vi.stubGlobal("fetch", api.fetch);
  const { container } = mounted(queryClientUnretried());
  await settled();
  const card = screen.getByRole("status", { name: "Needs you" });
  const bar = container.querySelector<HTMLElement>(".ticket-status");
  if (bar === null) throw new Error("no status bar drawn");
  expect(within(bar).queryByRole("button", { name: "Resume" })).toBeNull();

  await turned(() => {
    within(card).getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(within(bar).getByText("Waiting for actor…")).toBeDefined();
  expect(within(bar).getByRole("button", { name: "Cancel" })).toBeDefined();
  expect(
    within(bar)
      .getByRole("button", { name: "Revoke" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    within(card)
      .getByRole("button", { name: "Resume" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(api.posts()).toBe(1);
});

test("a cancellation that throws is said rather than swallowed", async () => {
  await following(accepting(deferred), queryClientUnretried());

  waiting.mode = "throw";
  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(screen.getByText("Cancel refused · the clock stopped")).toBeDefined();
});

test("an accepted cancellation ends the attempt it was asked about", async () => {
  await following(
    accepting((operation) => answer({ operation, state: "Cancelled" })),
    queryClientUnretried(),
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
  const client = queryClientUnretried();
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
  const client = queryClientUnretried();
  attemptHeld(client, 12, {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket: 12 },
    },
    operation: "op-held",
  });
  const view = mounted(client);
  await settled();
  expect(button("Cancel")).toBeNull();

  await navigated(view, client, "12");
  await settled();

  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(
    api.urls.some(
      (url) => url.startsWith("GET") && url.includes("/operations/op-held"),
    ),
  ).toBe(true);
  expect(api.posts()).toBe(0);
});

test("a refused cancellation does not outlive the follow it was about", async () => {
  const api = accepting(() =>
    answer({ error: { code: "OperationTerminal" } }, 409),
  );
  waiting.mode = "step";
  await following(api, queryClientUnretried());

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();
  expect(screen.getByText(/^Cancel refused · /)).toBeDefined();

  standing.state = "Cancelled";
  await stepped();

  expect(screen.getByText("Resume cancelled")).toBeDefined();
  expect(screen.queryByText(/^Cancel refused · /)).toBeNull();
});

test("a cancellation refused once its follow is confirming is still said", async () => {
  const refusing = held();
  waiting.mode = "step";
  await following(
    accepting(() => refusing.answering),
    queryClientUnretried(),
  );

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  standing.state = "Succeeded";
  await stepped();
  expect(button("Cancel")).toBeNull();

  await turned(() => {
    refusing.answer(answer({ error: { code: "OperationTerminal" } }, 409));
  });
  await settled();

  expect(screen.getByText(/^Cancel refused · /)).toBeDefined();
});

/** The held Cancel refused where no follow's notes are drawn, which is the
 * shell's toast and nothing on the page. */
async function cancelRefusedUndrawn(
  refusing: ReturnType<typeof held>,
  client: QueryClient,
): Promise<void> {
  await turned(() => {
    refusing.answer(answer({ error: { code: "OperationTerminal" } }, 409));
  });
  await settled();

  expect(screen.queryByText(/^Cancel refused · /)).toBeNull();
  expect(
    consoleWriteUnseenOf(tabStoreOf(client).getState()).map(
      (unseen) => unseen.sentence,
    ),
  ).toEqual([expect.stringMatching(/^Cancel refused · /)]);
}

test("a cancellation refused once its operation has finished is the shell's toast", async () => {
  const refusing = held();
  const rereading = held();
  let reread = false;
  waiting.mode = "step";
  const api = served({
    submission: (operation) => answer({ operation, state: "Pending" }, 202),
    openActions: () => (reread ? rereading.answering : answer({ actions: [] })),
    cancellation: () => refusing.answering,
  });
  const client = consoleQueryClient();
  await following(api, client);

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  reread = true;
  standing.state = "Answered";
  await stepped();
  expect(screen.getByText("Resume answered")).toBeDefined();

  await cancelRefusedUndrawn(refusing, client);
});

test("a cancellation refused while its follow is drawn is no toast", async () => {
  const client = consoleQueryClient();
  await following(
    accepting(() => answer({ error: { code: "OperationTerminal" } }, 409)),
    client,
  );

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(screen.getByText(/^Cancel refused · /)).toBeDefined();
  expect(consoleWriteUnseenOf(tabStoreOf(client).getState())).toEqual([]);
});

/** `api` with the ticket's own read answering `Absent` once `gone.absent` is
 * set, which takes the status bar's actions and their notes off the page. */
function ticketGoing(api: Served, gone: { absent: boolean }): Served {
  return {
    ...api,
    fetch: ((url: string, init?: Sent) =>
      gone.absent && /\/tickets\/\d+$/.test(url)
        ? Promise.resolve(answer({ error: { code: "Absent" } }, 404))
        : api.fetch(url, init)) as unknown as typeof fetch,
  };
}

/** The ticket read again, answering `Absent`, so no follow's notes are drawn. */
async function ticketGone(
  client: QueryClient,
  gone: { absent: boolean },
): Promise<void> {
  gone.absent = true;
  await turned(() => {
    void client.invalidateQueries();
  });
  await settled();
  expect(button("Cancel")).toBeNull();
}

test("a cancellation refused once the ticket's read is not ready is the shell's toast", async () => {
  const refusing = held();
  const gone = { absent: false };
  const client = consoleQueryClient();
  await following(
    ticketGoing(
      accepting(() => refusing.answering),
      gone,
    ),
    client,
  );
  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await ticketGone(client, gone);

  await cancelRefusedUndrawn(refusing, client);
});

test("a submission refused once the ticket's read is not ready is the shell's toast", async () => {
  const submitting = held();
  const gone = { absent: false };
  const client = consoleQueryClient();
  vi.stubGlobal(
    "fetch",
    ticketGoing(
      served({
        submission: () => submitting.answering,
        openActions: () => answer({ actions: [] }),
      }),
      gone,
    ).fetch,
  );
  mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await ticketGone(client, gone);

  await turned(() => {
    submitting.answer(answer({ error: { code: "Fault" } }, 500));
  });
  await settled();

  const [toast, ...more] = consoleWriteUnseenOf(tabStoreOf(client).getState());
  expect(more).toEqual([]);
  expect(toast).toBeDefined();
  expect(screen.queryByText(toast?.sentence ?? "")).toBeNull();
});

test("an unmount with the submission in flight still holds its identity", async () => {
  const submitting = held();
  const api = served({
    submission: () => submitting.answering,
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const client = queryClientUnretried();
  const view = mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });

  await turned(view.unmount);
  submitting.answer(
    answer({ operation: api.identities()[0] ?? "none", state: "Pending" }, 202),
  );
  mounted(client);
  await settled();

  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(api.urls.filter(polling)).toEqual([]);
  expect(api.identities()).toHaveLength(1);
  expect(api.posts()).toBe(1);
});

test("a submission the API never took is made again under the same identity", async () => {
  standing.known = false;
  const api = served({
    submission: (operation) => {
      standing.known = true;
      return answer({ operation, state: "Pending" }, 202);
    },
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const client = queryClientUnretried();
  attemptHeld(client, 11, {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket: 11 },
    },
    operation: "op-held",
  });
  waiting.mode = "step";
  mounted(client);
  await settled();
  await stepped();

  expect(api.posts()).toBe(1);
  expect(api.identities()).toEqual(["op-held"]);
  expect(screen.getByText("Waiting for actor…")).toBeDefined();
});

test("a cancellation does not overwrite a follow that ended while it was asked", async () => {
  const cancelling = held();
  waiting.mode = "step";
  const api = accepting(() => cancelling.answering);
  await following(api, queryClientUnretried());

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  standing.state = "Answered";
  await stepped();
  expect(screen.getByText("Resume answered")).toBeDefined();

  cancelling.answer(
    answer({ operation: api.identities()[0] ?? "none", state: "Cancelled" }),
  );
  await settled();

  expect(screen.getByText("Resume answered")).toBeDefined();
  expect(screen.queryByText("Resume cancelled")).toBeNull();
});

test("a cancellation is applied to the operation it asked about and no other", async () => {
  const cancelling = held();
  waiting.mode = "step";
  const api = accepting(() => cancelling.answering);
  const client = queryClientUnretried();
  await following(api, client);

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  standing.state = "Answered";
  await stepped();
  expect(screen.getByText("Resume answered")).toBeDefined();

  standing.state = "Pending";
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();
  const second = api.identities()[1];
  expect(second).toBeDefined();

  cancelling.answer(
    answer({ operation: api.identities()[0] ?? "none", state: "Cancelled" }),
  );
  await settled();

  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(screen.queryByText("Resume cancelled")).toBeNull();
  expect(attemptRead(client, 11)?.operation).toBe(second);
});

test("a submission whose answer was lost keeps the identity it was made under", async () => {
  const api = served({
    submission: () => Promise.reject(new Error("the connection went")),
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const client = queryClientUnretried();
  mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  const drawn = api.identities()[0];
  expect(drawn).toBeDefined();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
  expect(attemptRead(client, 11)?.operation).toBe(drawn);
});

/** A submission whose answer never came back, which is the one ending that
 * leaves a record standing and the buttons able to be pressed again. */
async function unanswered(api: Served, client: QueryClient): Promise<void> {
  vi.stubGlobal("fetch", api.fetch);
  mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();
  expect(api.identities()).toHaveLength(1);
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
}

function losing(): Served {
  return served({
    submission: () => Promise.reject(new Error("the connection went")),
    openActions: () => answer({ actions: [] }),
  });
}

/** Pressing where a record stands: the press reaches what is held and polls
 * it, rather than drawing a second identity for the same intent. */
async function pressedAgain(api: Served): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(api.identities()).toHaveLength(1);
  expect(api.urls.filter(polling)).not.toEqual([]);
  expect(screen.getByText("Waiting for actor…")).toBeDefined();
}

test("pressing again reaches the held attempt rather than drawing a second", async () => {
  const api = losing();
  await unanswered(api, queryClientUnretried());
  await pressedAgain(api);
});

test("a press naming another action still resolves the attempt that is held", async () => {
  waiting.mode = "step";
  const api = losing();
  await unanswered(api, queryClientUnretried());

  await turned(() => {
    screen.getByRole("button", { name: "Revoke" }).click();
  });
  await turned(() => {
    screen.getByRole("button", { name: "Revoke ticket" }).click();
  });
  await settled();
  standing.state = "Answered";
  await stepped();

  expect(api.identities()).toHaveLength(1);
  expect(screen.getByText("Resume answered")).toBeDefined();
  expect(screen.queryByText("Revoke answered")).toBeNull();
});

/** A submission the API declines outright: the identity it names will never be
 * an operation, so nothing is left to ask about. */
function refusing(): Served {
  return served({
    submission: () => answer({ error: { code: "TicketVersionStale" } }, 409),
    openActions: () => answer({ actions: [] }),
  });
}

test("a submission the API refuses leaves no record to ask about again", async () => {
  const api = refusing();
  vi.stubGlobal("fetch", api.fetch);
  const client = queryClientUnretried();
  mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(api.identities()).toHaveLength(1);
  expect(attemptRead(client, 11)).toBeUndefined();
});

test("a refusal leaves the next press free to mean a new intent", async () => {
  const api = refusing();
  vi.stubGlobal("fetch", api.fetch);
  mounted(queryClientUnretried());
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(api.identities()).toHaveLength(2);
  expect(api.posts()).toBe(2);
});

test("a refused submission says one word, its code on hover and in no line", async () => {
  vi.stubGlobal("fetch", refusing().fetch);
  mounted(queryClientUnretried());
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(document.body.textContent).not.toContain("TicketVersionStale");
  fireEvent.focus(screen.getByText("Refused"));
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "TicketVersionStale",
  );
});

/** A submission the API faults on, which says nothing about whether it acted:
 * a handler that committed the acceptance and fell over on the way to reporting
 * it answers exactly like one that did nothing. */
function faulting(): Served {
  return served({
    submission: () => answer({ error: { code: "Fault" } }, 500),
    openActions: () => answer({ actions: [] }),
  });
}

test("a faulted submission may have been taken, so its identity is kept", async () => {
  const api = faulting();
  vi.stubGlobal("fetch", api.fetch);
  const client = queryClientUnretried();
  mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(attemptRead(client, 11)?.operation).toBe(api.identities()[0]);

  await pressedAgain(api);
});
