/**
 * The one property the inbox screen owns that no pure function can express: an
 * answered row stays until the project says it moved.
 *
 * The core has no seam for the answer path — the click, the follow and the
 * cache are shell code by construction — so this is the lowest tier that can
 * express it, and the harness is `stream.test.tsx`'s: a query client, the
 * stream provider driven by a scripted server, and the API answered by a stub
 * of the one global the client reaches. The operation stays pending, so the row
 * is looked at while its answer is still in flight.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));

/** The stubbed global goes back whatever a case did with it, including a case
 * that stops partway; the rendered tree is the testing library's own cleanup. */
afterEach(() => {
  vi.unstubAllGlobals();
});

const escalated = {
  ticket: 4,
  phase: "Escalated",
  sequence: 9,
  reason: "WorkFailed",
};

const working = { ticket: 4, phase: "Working", sequence: 11 };

function holderDouble(): SessionHolder {
  return {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve("token"),
    refresh: () => Promise.resolve(true),
    refuse: () => undefined,
    refreshDueAtMs: () => undefined,
    generation: () => 1,
    snapshot: () => ({
      phase: "SignedIn" as const,
      reason: undefined,
      configuration: undefined,
    }),
    subscribe: () => () => undefined,
  };
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/vnd.chuggy.v1+json" },
  });
}

/**
 * The API as this case needs it: one escalated ticket, no executions, and an
 * operation the actor never decides.
 */
function apiDouble(): {
  readonly fetch: typeof fetch;
  readonly submissions: () => number;
} {
  let submissions = 0;
  const served = (
    url: string,
    init?: { readonly method?: string },
  ): Response => {
    if (init?.method === "POST") {
      submissions += 1;
      return answer({ operation: "op-one", state: "Pending" }, 202);
    }
    if (url.includes("/operations/"))
      return answer({
        operation: "op-one",
        acceptedAt: "2026-08-26T10:00:00Z",
        state: "Pending",
      });
    if (url.includes("/executions")) return answer({ executions: [] });
    return answer({ partition: atlas, sequence: 9, tickets: [escalated] });
  };
  return {
    submissions: () => submissions,
    fetch: ((url: string, init?: { readonly method?: string }) =>
      Promise.resolve(served(url, init))) as unknown as typeof fetch,
  };
}

type StreamTransport = NonNullable<
  Parameters<typeof ProjectStreamProvider>[0]["transport"]
>;

function Harness(props: {
  readonly client: QueryClient;
  readonly transport: StreamTransport;
}): ReactNode {
  return (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={props.client}>
        <ProjectStreamProvider partition={atlas} transport={props.transport}>
          <InboxScreen partition={atlas} />
        </ProjectStreamProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("an answered row stays until a Ticket frame moves it out of the section", async () => {
  const api = apiDouble();
  vi.stubGlobal("fetch", api.fetch);
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("ready", undefined, { version: 1 })],
      hold: true,
    },
  ]);
  render(<Harness client={new QueryClient()} transport={server.ports.fetch} />);
  await settled();
  expect(screen.getByRole("button", { name: "resume" })).toBeDefined();

  await act(async () => {
    screen.getByRole("button", { name: "resume" }).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(api.submissions()).toBe(1);
  expect(
    screen.queryByRole("button", { name: "resume" }),
    "the answered row left the inbox before a frame said the ticket had moved",
  ).not.toBeNull();
  expect(screen.queryByText(/nothing needs you here/u)).toBeNull();

  await act(async () => {
    server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: working,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
  expect(screen.getByText(/nothing needs you here/u)).toBeDefined();
});
