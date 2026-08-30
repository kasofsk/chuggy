/**
 * The ticket page's dispatch availability, kept live by the stream.
 *
 * The entry is the server's own candidate view and a `Ticket` frame does not
 * carry it, so what is checked is that the frame reaches the entry at all: the
 * button appears with nothing reloaded and nothing submitted from this screen.
 * A release made on the creation screen is exactly such a frame, and it is the
 * one that used to arrive at an entry no fold was registered for.
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
  ticketPageRoutes,
  ticketPageTicket,
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

function ticketFrame(resource: string): string {
  return frame("Ticket", "8", {
    version: 1,
    resource,
    representation: ticketPageTicket,
  });
}

test("this ticket's own frame makes its dispatch availability be read again", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable);
  await settled();
  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();

  dispatchable = true;
  await turned(() => {
    server.push(ticketFrame("11"));
  });
  await settled();

  expect(screen.getByRole("button", { name: "dispatch" })).toBeDefined();
});

test("another ticket's frame leaves this ticket's dispatch entry alone", async () => {
  let dispatchable = false;
  const server = drawn(() => dispatchable);
  await settled();

  dispatchable = true;
  await turned(() => {
    server.push(ticketFrame("12"));
  });
  await settled();

  expect(screen.queryByRole("button", { name: "dispatch" })).toBeNull();
});
