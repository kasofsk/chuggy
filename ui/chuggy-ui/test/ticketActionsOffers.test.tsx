/**
 * Duplicate on a ticket's page: drawn in the header in every phase, leading
 * where the ticket is Done or Revoked and in the menu otherwise, as a link to
 * the new-ticket address naming this ticket. It writes nothing. Beside it,
 * which of Edit and Revoke a reader is offered.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode, Ref } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  queryClientUnretried,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketHeaderMenuLabel } from "../app/browser/ticket/TicketHeaderMenu.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketPageEveryTab,
  ticketHeader,
  ticketHeaderMenuOpened,
} from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

interface LinkStub {
  readonly ref?: Ref<HTMLAnchorElement>;
  readonly to?: string;
  readonly search?: unknown;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => {
  const stub = (props: LinkStub) => (
    <a
      href="/"
      ref={props.ref}
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
 * reads do unless the case hands a `fetch` of its own over them, and copying
 * through `write` where the case hands one. */
async function bar(
  phase: TicketPhase,
  actionsRead = true,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
  write?: CopyWrite,
): Promise<{ readonly api: ApiDouble; readonly header: HTMLElement }> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: routed(phase, actionsRead),
  });
  vi.stubGlobal("fetch", over(api.fetch));
  const { container } = render(
    <ScreenHarness
      partition={atlas}
      client={queryClientUnretried()}
      transport={openedStream().ports.fetch}
    >
      {write === undefined ? (
        <TicketPageEveryTab />
      ) : (
        <CopyProvider write={write}>
          <TicketPageEveryTab />
        </CopyProvider>
      )}
    </ScreenHarness>,
  );
  await settled();
  const drawn = container.querySelector<HTMLElement>("header.ticket-header");
  if (drawn === null) throw new Error("no ticket header drawn");
  return { api, header: drawn };
}

/** The Duplicate a ticket's header offers, and whether it leads or is in
 * the menu. The stubbed link draws none of the props the menu's item hands
 * it, so the item is found by its words. */
async function duplicateOffered(): Promise<{
  readonly leads: boolean;
  readonly link: HTMLElement | null;
}> {
  const leading = within(ticketHeader()).queryByRole("link", {
    name: "Duplicate",
  });
  if (leading !== null) return { leads: true, link: leading };
  return {
    leads: false,
    link:
      within(await ticketHeaderMenuOpened())
        .queryByText("Duplicate")
        ?.closest("a") ?? null,
  };
}

test.each(phaseRoster)(
  "a %s ticket offers Duplicate, leading only where it is finished",
  async (phase) => {
    await bar(phase);
    const { leads, link } = await duplicateOffered();
    expect(leads).toBe(phase === "Done" || phase === "Revoked");
    expect(link?.dataset["to"]).toBe("/$tenant/$project/tickets/new");
    expect(link?.dataset["search"]).toBe(JSON.stringify({ from: 11 }));
  },
);

test("Duplicate is offered where the open actions could not be read", async () => {
  await bar("Escalated", false);
  expect((await duplicateOffered()).link).not.toBeNull();
});

test("a reader who may not mutate is offered no Duplicate", async () => {
  await bar("Done", true, abilitiesOver({ ...abilitiesEvery, mutate: false }));
  expect(
    within(ticketHeader()).queryByRole("link", { name: "Duplicate" }),
  ).toBeNull();
});

/** Which of what a Pending ticket's page and an Escalated one's offer a
 * reader are drawn: Edit, and the Revoke the header's menu holds. */
async function offeredTo(
  abilities: AbilitiesAnswer,
): Promise<Record<string, boolean>> {
  const over = abilitiesOver(abilities);
  const named = (role: string, name: string): boolean =>
    screen.queryByRole(role, { name }) !== null;
  await bar("Pending", true, over);
  const pending = {
    edit: named("link", "Edit"),
  };
  cleanup();
  await bar("Escalated", true, over);
  return {
    ...pending,
    revoke:
      named("button", ticketHeaderMenuLabel) &&
      within(await ticketHeaderMenuOpened()).queryByRole("menuitem", {
        name: "Revoke…",
      }) !== null,
  };
}

test("a reader who may not mutate is offered no Edit or Revoke", async () => {
  expect(await offeredTo({ ...abilitiesEvery, mutate: false })).toStrictEqual({
    edit: false,
    revoke: false,
  });
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Edit and Revoke",
  async (_said, abilities) => {
    expect(await offeredTo(abilities)).toStrictEqual({
      edit: true,
      revoke: true,
    });
  },
);

test("Copy link writes the ticket page's whole address, and says it did", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
  await bar("Escalated", true, undefined, write);
  const menu = await ticketHeaderMenuOpened();
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledWith(
    `${location.origin}/acme/atlas/tickets/11`,
  );
  expect(screen.getByRole("menu")).toBe(menu);
  expect(within(menu).getByRole("menuitem", { name: "Copied" })).toBeDefined();
  expect(within(ticketHeader()).getByRole("status").textContent).toBe("Copied");
});

test("a write the browser refused claims nothing", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(false));
  await bar("Escalated", true, undefined, write);
  const menu = await ticketHeaderMenuOpened();
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(within(menu).queryByRole("menuitem", { name: "Copied" })).toBeNull();
  expect(within(ticketHeader()).getByRole("status").textContent).toBe("");
});
