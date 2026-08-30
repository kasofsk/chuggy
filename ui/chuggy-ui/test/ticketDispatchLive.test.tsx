/**
 * The ticket page's dispatch availability, kept live by the stream.
 *
 * THE FRAME IS ANOTHER TICKET'S. A ticket becomes dispatchable when its last
 * dependency reaches Done, and the decision leaves the dependent's own row
 * alone, so the only frame the console ever sees is the dependency's — a case
 * that pushed this ticket's own frame would pass against a console that reads
 * nothing for the reader whose page is open.
 *
 * `sleepMs` is the real one here, unlike the sibling case that follows an
 * operation: this case wants the bounded fallback to stay asleep, so that the
 * only thing that can refresh the entry is the frame.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import {
  ticketDispatchViewOf,
  ticketPageCandidate,
  ticketPageDependency,
  ticketPageRoutes,
} from "./ticketPageFixture.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A turn of the runner, which is what a read is made to take more than one of
 * so that a frame can arrive while one is still going. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The same API, answering a turn later than it was asked, so a case can push a
 * frame at a read that has not come back. */
function readingSlowly(answering: typeof fetch, turns: number): typeof fetch {
  return (async (url: string, init?: unknown) => {
    for (let turn = 0; turn < turns; turn += 1) await tick();
    return (
      answering as unknown as (u: string, i?: unknown) => Promise<Response>
    )(url, init);
  }) as unknown as typeof fetch;
}

/** One ticket page over an API whose dispatch answer the case changes. */
function drawn(
  dispatchable: () => boolean,
  turns = 0,
): ReturnType<typeof openedStream> {
  const api = apiDouble({
    operation: operationAt("Succeeded"),
    route: ticketPageRoutes(atlas, () =>
      ticketDispatchViewOf(atlas, dispatchable() ? [ticketPageCandidate] : []),
    ),
  });
  vi.stubGlobal("fetch", readingSlowly(api.fetch, turns));
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  return server;
}

/** The dependency reaching Done, which is the frame that makes the ticket on
 * screen dispatchable without ever naming it. */
function dependencyDoneFrame(): string {
  return frame("Ticket", "8", {
    version: 1,
    resource: String(ticketPageDependency.ticket),
    representation: ticketPageDependency,
  });
}

test("a dependency's frame makes this ticket's dispatch availability be read again", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable);
  await settled();
  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();

  dispatchable = true;
  await turned(() => {
    server.push(dependencyDoneFrame());
  });
  await settled();

  expect(screen.getByRole("button", { name: "dispatch" })).toBeDefined();
});

/** A frame of a kind the dispatch entry does not follow, which is what says the
 * case above turned on the frame's kind rather than on any frame arriving. */
function configurationFrame(): string {
  return frame("Configuration", "9", {
    version: 1,
    resource: "r2",
    representation: {
      partition: atlas,
      revision: "r2",
      canonical: "{}",
      digest: "d".repeat(64),
    },
  });
}

test("a configuration frame leaves the dispatch entry where it was read", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable);
  await settled();

  dispatchable = true;
  await turned(() => {
    server.push(configurationFrame());
  });
  await settled();

  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();
});

/**
 * A BURST MUST NOT STARVE THE READ IT ASKS FOR: every frame of the kind stales
 * this entry and the query cache cancels an in-flight refetch by default, so
 * frames arriving faster than the API answers would restart the read at each
 * one and the button would wait for the burst to stop. The read here takes two
 * turns and the burst runs for longer, so a read allowed to finish has.
 */
test("a burst of frames does not stop the dispatch read from finishing", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable, 2);
  await settled();
  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();

  dispatchable = true;
  for (let pushed = 0; pushed < 10; pushed += 1)
    await turned(() => {
      server.push(dependencyDoneFrame());
    });

  expect(screen.getByRole("button", { name: "dispatch" })).toBeDefined();
});
