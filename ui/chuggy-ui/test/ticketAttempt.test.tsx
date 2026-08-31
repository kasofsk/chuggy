/**
 * What the actions panel says about an attempt it cannot see the end of: a
 * follow or a cancellation that threw rather than answered, a panel remounted
 * while one was still running, and an open-actions read that has not come back.
 *
 * Each is a state the panel used to draw as though nothing had happened — a
 * swallowed rejection left it busy for ever, a cancellation the actor took left
 * the follow polling behind it, a remount replaced a running attempt with the
 * button that started it, and an unread action list was drawn as the phase's
 * guess at what the actor admits.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** The wait a case wants: held open, or thrown out of. */
const waiting = vi.hoisted(() => ({ thrown: false }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.thrown
      ? Promise.reject(new Error("the clock stopped"))
      : new Promise<void>(() => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  waiting.thrown = false;
  vi.unstubAllGlobals();
});

/** A ticket parked with a resume the machine stamped and the gas to pay it,
 * which is the one shape that offers a Resume the reader can press. */
const parked = {
  ticket: 11,
  phase: "Escalated",
  sequence: 7,
  reason: "WorkFailed",
  resumeAt: "ResumeWorking",
  accounts: { gasLeft: 5, gasMax: 5, reworkLeft: 1 },
  ...ticketInstants,
};

const pendingOperation = {
  operation: "op-one",
  acceptedAt: "2026-08-26T10:00:00Z",
  state: "Pending",
};

interface Served {
  readonly urls: readonly string[];
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
  const respond = (url: string, method: string | undefined): Response => {
    if (method === "POST") return scripted.submission();
    if (method === "DELETE") return (scripted.cancellation ?? deferred)();
    if (url.includes("/operations/")) return answer(pendingOperation);
    if (url.includes("/native-actions")) return scripted.openActions();
    if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(parked);
    return answer({ partition: atlas, sequence: 7, tickets: [parked] });
  };
  return {
    urls,
    fetch: ((url: string, init?: { readonly method?: string }) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(respond(url, init?.method));
    }) as unknown as typeof fetch,
  };
}

/** The page under its providers, returning the unmount a case remounts over. */
function mounted(client: QueryClient): () => void {
  return render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  ).unmount;
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

  waiting.thrown = true;
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();

  expect(screen.getByText("the clock stopped")).toBeDefined();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
});

test("a panel remounted mid-follow picks the attempt back up", async () => {
  const api = served({
    submission: () => answer({ operation: "op-one", state: "Pending" }, 202),
    openActions: () => answer({ actions: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const client = new QueryClient();
  const unmount = mounted(client);
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();
  expect(button("Cancel")).not.toBeNull();

  await turned(unmount);
  mounted(client);
  await settled();

  expect(
    api.urls.some(
      (url) => url.startsWith("GET") && url.includes("/operations/op-one"),
    ),
  ).toBe(true);
  expect(screen.getByText("Waiting for actor…")).toBeDefined();
  expect(button("Cancel")).not.toBeNull();
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

/** The panel with an attempt parked at `Following`, which is where Cancel is
 * the only button there is. */
async function following(api: Served): Promise<void> {
  vi.stubGlobal("fetch", api.fetch);
  mounted(new QueryClient());
  await settled();
  await turned(() => {
    screen.getByRole("button", { name: "Resume" }).click();
  });
  await settled();
}

test("a cancellation that throws is said rather than swallowed", async () => {
  await following(
    served({
      submission: () => answer({ operation: "op-one", state: "Pending" }, 202),
      openActions: () => answer({ actions: [] }),
      cancellation: deferred,
    }),
  );

  waiting.thrown = true;
  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(screen.getByText("Cancel refused · the clock stopped")).toBeDefined();
});

test("an accepted cancellation ends the attempt it was asked about", async () => {
  const api = served({
    submission: () => answer({ operation: "op-one", state: "Pending" }, 202),
    openActions: () => answer({ actions: [] }),
    cancellation: () => answer({ operation: "op-one", state: "Cancelled" }),
  });
  await following(api);

  await turned(() => {
    screen.getByRole("button", { name: "Cancel" }).click();
  });
  await settled();

  expect(button("Cancel")).toBeNull();
  expect(screen.getByText("Resume cancelled")).toBeDefined();
  expect(button("Resume")?.hasAttribute("disabled")).toBe(false);
});
