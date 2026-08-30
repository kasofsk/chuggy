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

/** One ticket page over an API whose dispatch answer the case changes. */
function drawn(dispatchable: () => boolean): ReturnType<typeof openedStream> {
  const api = apiDouble({
    operation: operationAt("Succeeded"),
    route: ticketPageRoutes(atlas, () =>
      ticketDispatchViewOf(atlas, dispatchable() ? [ticketPageCandidate] : []),
    ),
  });
  vi.stubGlobal("fetch", api.fetch);
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

/** The other half of the case above: without the frame the entry stands, so
 * what drew the button there was the frame and not a rerender. */
test("an unchanged project leaves the dispatch entry where it was read", async () => {
  let dispatchable = false;
  drawn(() => dispatchable);
  await settled();

  dispatchable = true;
  await settled();

  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();
});
