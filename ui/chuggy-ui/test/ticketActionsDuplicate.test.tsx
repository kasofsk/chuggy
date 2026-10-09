/**
 * Duplicate on a ticket's page: drawn in the bar in every phase, Revoked and
 * Done among them, and whether or not the open actions could be read, as a
 * link to the new-ticket address naming this ticket. It writes nothing.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import { ticketDuplicateEffect } from "../app/core/codeLabels.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

interface LinkStub {
  readonly to?: string;
  readonly search?: unknown;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => {
  const stub = (props: LinkStub) => (
    <a
      href="/"
      data-to={props.to}
      data-search={
        props.search === undefined ? undefined : JSON.stringify(props.search)
      }
    >
      {props.children}
    </a>
  );
  return {
    createLink: () => stub,
    Link: stub,
    useParams: () => ({ ...atlas, ticket: "11" }),
  };
});
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routed(
  phase: TicketPhase,
  actionsRead: boolean,
): (url: string) => Response {
  const ticket = { ticket: 11, phase, sequence: 7, ...ticketInstants };
  return (url) => {
    if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
    if (url.includes("/native-actions"))
      return actionsRead
        ? answer({ actions: [] })
        : answer({ error: { code: "InternalError" } }, 500);
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(ticket);
    return answer({ partition: atlas, sequence: 7, tickets: [ticket] });
  };
}

/** The page of a ticket in `phase`, the abilities read answering as its other
 * reads do unless the case hands a `fetch` of its own over them. */
async function bar(
  phase: TicketPhase,
  actionsRead = true,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<{ readonly api: ApiDouble; readonly bar: HTMLElement }> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: routed(phase, actionsRead),
  });
  vi.stubGlobal("fetch", over(api.fetch));
  const { container } = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  const drawn = container.querySelector<HTMLElement>(".ticket-status");
  if (drawn === null) throw new Error("no status bar drawn");
  return { api, bar: drawn };
}

function duplicateOf(drawn: HTMLElement): HTMLElement {
  return within(drawn).getByRole("link", { name: "Duplicate" });
}

test.each(phaseRoster)(
  "a %s ticket offers Duplicate, to a new ticket from this one",
  async (phase) => {
    const { api, bar: drawn } = await bar(phase);
    const link = duplicateOf(drawn);
    expect(link.dataset["to"]).toBe("/$tenant/$project/tickets/new");
    expect(JSON.parse(link.dataset["search"] ?? "null")).toStrictEqual({
      from: 11,
    });
    expect(within(drawn).getByText(ticketDuplicateEffect)).toBeTruthy();
    expect(api.submissions()).toBe(0);
  },
);

test("Duplicate is offered where the open actions could not be read", async () => {
  const { bar: drawn } = await bar("Escalated", false);
  expect(duplicateOf(drawn)).toBeTruthy();
});

/** Which of what a Pending ticket's page and an Escalated one's offer a
 * reader are drawn: the two links, and the answer the bar holds. */
async function offeredTo(
  abilities: AbilitiesAnswer,
): Promise<Record<string, boolean>> {
  const over = abilitiesOver(abilities);
  const named = (role: string, name: string): boolean =>
    screen.queryByRole(role, { name }) !== null;
  await bar("Pending", true, over);
  const pending = {
    edit: named("link", "Edit"),
    duplicate: named("link", "Duplicate"),
  };
  cleanup();
  await bar("Escalated", true, over);
  return {
    ...pending,
    revoke: named("button", "Revoke"),
    duplicateParked: named("link", "Duplicate"),
  };
}

test("a reader who may not mutate is offered no Edit, Duplicate or Revoke", async () => {
  expect(await offeredTo({ ...abilitiesEvery, mutate: false })).toStrictEqual({
    edit: false,
    duplicate: false,
    revoke: false,
    duplicateParked: false,
  });
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Edit, Duplicate and Revoke",
  async (_said, abilities) => {
    expect(await offeredTo(abilities)).toStrictEqual({
      edit: true,
      duplicate: true,
      revoke: true,
      duplicateParked: true,
    });
  },
);
