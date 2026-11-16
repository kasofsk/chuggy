/**
 * Duplicate on a ticket's page: drawn in the header in every phase, leading
 * where the ticket is Done or Revoked and in the menu otherwise, as a link to
 * the new-ticket address naming this ticket. It writes nothing. Beside it,
 * the header menu's entries by what the reader may do.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
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
  turned,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import { abilitiesEvery, abilitiesOver } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketPageEveryTab,
  ticketHeader,
  ticketHeaderMenuEntries,
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
  const { container } = renderCopied(
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
  const drawn = container.querySelector<HTMLElement>("header.page-header");
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

/** The header menu's entries on a Pending ticket's page and on an Escalated
 * one's, for a reader the abilities read answers as `abilities` says. */
async function offeredTo(
  abilities: AbilitiesAnswer,
): Promise<Record<"pending" | "escalated", readonly string[]>> {
  const over = abilitiesOver(abilities);
  await bar("Pending", true, over);
  const pending = await ticketHeaderMenuEntries();
  cleanup();
  await bar("Escalated", true, over);
  return { pending, escalated: await ticketHeaderMenuEntries() };
}

test("a reader who may not mutate is offered no menu: no Edit, Duplicate or Revoke", async () => {
  expect(await offeredTo({ ...abilitiesEvery, mutate: false })).toStrictEqual({
    pending: [],
    escalated: [],
  });
});

test("a reader who may is offered Edit, Take, Duplicate and the destructive Revoke in the menu", async () => {
  expect(await offeredTo(abilitiesEvery)).toStrictEqual({
    pending: ["Edit", "Take", "Duplicate", "Revoke…"],
    escalated: ["Take", "Duplicate", "Revoke…"],
  });
});

/** Take names the reader, whom an unanswered read has not said. */
test("a reader the abilities read has not answered for is offered the menu but Take", async () => {
  expect(await offeredTo(undefined)).toStrictEqual({
    pending: ["Edit", "Duplicate", "Revoke…"],
    escalated: ["Duplicate", "Revoke…"],
  });
});

test("Revoke is marked destructive in the menu and asks before it submits", async () => {
  const { api } = await bar("Escalated");
  const menu = await ticketHeaderMenuOpened();
  const revoke = within(menu).getByRole("menuitem", { name: "Revoke…" });
  expect(revoke.classList.contains("more-menu-destructive")).toBe(true);
  for (const other of within(menu).getAllByRole("menuitem"))
    if (other !== revoke)
      expect(other.classList.contains("more-menu-destructive")).toBe(false);
  await turned(() => {
    fireEvent.click(revoke);
  });
  expect(screen.getByRole("dialog", { name: /revoke/iu })).toBeDefined();
  expect(api.submissions()).toBe(0);
});

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

/** What the header draws to press outside its menu. */
function headerPressesDrawn(): readonly string[] {
  return [
    ...within(ticketHeader()).queryAllByRole("button"),
    ...within(ticketHeader()).queryAllByRole("link"),
  ]
    .map((press) => press.textContent ?? "")
    .filter((name) => name !== "");
}

test.each(phaseRoster)(
  "a %s ticket's title is the page's one heading, and the header leads with Duplicate only where it is finished",
  async (phase) => {
    await bar(phase);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(ticketHeader().contains(headings[0] ?? null)).toBe(true);
    expect(headerPressesDrawn()).toStrictEqual(
      phase === "Done" || phase === "Revoked" ? ["Duplicate"] : [],
    );
  },
);
