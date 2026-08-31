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
  createLink: (component: unknown) => component,
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

/**
 * The same API, answering some turns after it was asked, so a case can push a
 * frame at a read that has not come back. THE ANSWER IS DECIDED WHEN THE
 * REQUEST ARRIVES, which is what a server does and what makes a read issued
 * before a change carry the world from before it.
 */
function readingSlowly(answering: typeof fetch, turns: number): typeof fetch {
  return (async (url: string, init?: unknown) => {
    const answered = await (
      answering as unknown as (u: string, i?: unknown) => Promise<Response>
    )(url, init);
    for (let turn = 0; turn < turns; turn += 1) await tick();
    return answered;
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

/** Some other ticket moving, which stales this entry like any frame of the kind
 * and is how a case gets a read in flight to push at. */
function unrelatedTicketFrame(): string {
  return frame("Ticket", "7", {
    version: 1,
    resource: "40",
    representation: { ticket: 40, phase: "Working", sequence: 6 },
  });
}

test("a dependency's frame makes this ticket's dispatch availability be read again", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable);
  await settled();
  expect(screen.queryByRole("button", { name: "Dispatch" })).toBeNull();

  dispatchable = true;
  await turned(() => {
    server.push(dependencyDoneFrame());
  });
  await settled();

  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
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

  expect(screen.queryByRole("button", { name: "Dispatch" })).toBeNull();
});

/**
 * A FRAME ARRIVING MID-READ MUST STILL BE READ FOR. The read in flight asked
 * the API before this frame's change existed, so its answer cannot carry it;
 * joining that read rather than restarting it would settle the entry on the
 * older answer and clear the staleness the frame had just set, and nothing
 * would ask again — the switcher's other refetches are off and the fallback is
 * down while the stream carries.
 */
test("a frame arriving while a read is in flight is still read for", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable, 2);
  await settled();
  expect(screen.queryByRole("button", { name: "Dispatch" })).toBeNull();

  await turned(() => {
    server.push(unrelatedTicketFrame());
  });
  dispatchable = true;
  await turned(() => {
    server.push(dependencyDoneFrame());
  });
  await settled();

  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
});

/**
 * A burst restarts the read at every frame, so nothing is drawn until it stops
 * — bounded, self-healing, and unmeasured on a rig (kasofsk/chuggy#443). What
 * has to hold is where it lands: the entry after the burst is what the API said
 * after the last frame in it.
 */
test("a burst of frames leaves the dispatch entry correct once it stops", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable, 2);
  await settled();

  dispatchable = true;
  for (let pushed = 0; pushed < 10; pushed += 1)
    await turned(() => {
      server.push(dependencyDoneFrame());
    });
  await settled();

  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
});
