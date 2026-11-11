/**
 * The ticket page's header over the project's landing queues: a queued
 * ticket's place beside its state label's fragment, none for a ticket in no
 * queue, and a queue read that fails leaving the page drawn.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { QueryStatus } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { landingQueuesQuery } from "../app/core/ticketQueries.ts";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  ticketPageAmbientRoute,
} from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import { TicketPageEveryTab } from "./ticketPageEveryTab.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "21" }),
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

const repository = "https://github.com/acme/widgets.git";

/** The page drawn once its queue read has come to `status`, so a case
 * asserting what the read drew asserts it over an answered read. */
async function pageDrawn(
  queues: () => Response,
  status: QueryStatus,
): Promise<HTMLElement> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const ambient = ticketPageAmbientRoute(url);
      if (ambient !== undefined) return ambient;
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/drafts/")) return answer({}, 404);
      return answer({
        ticket: 21,
        title: "Land the console",
        phase: "Work",
        sequence: 9,
        ...ticketInstants,
        brief: { intent: "Land the console", links: [] },
      });
    },
    queues,
  });
  vi.stubGlobal("fetch", api.fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>,
  );
  await settled();
  await vi.waitFor(() => {
    expect(
      client.getQueryState(landingQueuesQuery(atlas).queryKey)?.status,
    ).toBe(status);
  });
  await settled();
  const state = document.querySelector<HTMLElement>(
    "header.ticket-header .ticket-header-state",
  );
  if (state === null) throw new Error("the header's state is drawn");
  return state;
}

test("a queued ticket's header draws its place after its state label's fragment", async () => {
  const state = await pageDrawn(
    () =>
      answer({
        queues: [{ repository, holder: 8, waiting: [21] }],
        truncated: false,
      }),
    "success",
  );
  const chip = within(state).getByRole("img", {
    name: `Waiting 2 of 2 to land: #8 holds ${repository}'s default branch`,
  });
  expect(chip.textContent).toBe("2/2");
  expect(state.lastElementChild).toBe(chip);
  expect(state.querySelector(".ticket-state")).not.toBeNull();
});

test("a ticket in no queue draws no chip in its header", async () => {
  const state = await pageDrawn(
    () =>
      answer({
        queues: [{ repository, holder: 8, waiting: [9] }],
        truncated: false,
      }),
    "success",
  );
  expect(state.querySelector(".landing-queue-chip")).toBeNull();
});

test("a queue read that fails draws no chip and leaves the page drawn", async () => {
  let asked = 0;
  const state = await pageDrawn(() => {
    asked += 1;
    return answer({ error: { code: "InternalError" } }, 500);
  }, "error");
  expect(asked).toBeGreaterThan(0);
  expect(state.querySelector(".landing-queue-chip")).toBeNull();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "Land the console",
  );
  expect(screen.getByRole("navigation", { name: "Ticket" })).toBeTruthy();
});
