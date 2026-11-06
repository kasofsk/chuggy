/**
 * A draft never released at its ticket's address: the ticket page in Draft
 * state, read from the draft. Release sends the form's own release and the
 * page then draws the ticket it made; Delete asks before it deletes and then
 * goes to the ticket list; a ticket that was released draws its own page; and
 * the page at another ticket's address never draws the draft it drew here.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode, Ref } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { DraftResponse } from "../../../src/contract/responses.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  heldAnswer,
  turned,
} from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { draftQuery } from "../app/core/ticketQueries.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketPageEveryTab,
  ticketHeader,
  ticketHeaderMenuOpened,
} from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "vteng", project: "chuggy" };

const navigated = vi.hoisted(() => ({ to: [] as unknown[] }));
/** The ticket the page's address names. */
const addressed = vi.hoisted(() => ({ ticket: "335" }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly children?: ReactNode;
    readonly ref?: Ref<HTMLAnchorElement>;
  }) => (
    <a href="/" ref={props.ref}>
      {props.children}
    </a>
  ),
  useParams: () => ({ ...atlas, ticket: addressed.ticket }),
  useNavigate: () => (to: unknown) => {
    navigated.to.push(to);
    return Promise.resolve();
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
  navigated.to.length = 0;
  addressed.ticket = "335";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const intent = "Lock the worker contract";

/** Ticket 335's draft, never released. */
const drafted: DraftResponse = {
  partition: atlas,
  ticket: 335,
  authoringVersion: 3,
  state: "Draft",
  configurationRevision: "r6",
  authoring: { dependencies: [], program: [] },
  brief: {
    title: "worker: lock contract 1.36.0",
    intent,
    links: [],
    repository: "https://forge.test/kasofsk/chuggy-common",
    branch: "refs/heads/contract/thread-offer-tools",
  },
};

/** The draft once released. */
const releasedDraft: DraftResponse = {
  ...drafted,
  state: "Released",
  releasedAuthoringVersion: drafted.authoringVersion,
};

/** The ticket its release makes, as its own read and the project's row say. */
const releasedTicket = {
  ticket: 335,
  title: "worker: lock contract 1.36.0",
  phase: "Pending",
  sequence: 9,
  creator: "dave@vteng.io",
  ...ticketInstants,
  brief: drafted.brief,
  configurationRevision: "r6",
};

interface Served {
  readonly deletes: string[];
  readonly submitted: () => unknown;
  /** A frame of the project's stream, writing the draft read as it says. */
  readonly drafted: (draft: DraftResponse) => void;
  /** The page drawn again, at whatever address the case now names. */
  readonly redrawn: () => void;
}

/** What a case holds back: the ticket read once the draft is released, or the
 * deletion's answer. */
interface Holding {
  readonly ticket?: Promise<Response>;
  readonly deletion?: Promise<Response>;
  /** Ticket 336's own read: its draft is read released. */
  readonly other?: Promise<Response>;
}

/** The page over ticket 335: a draft until something is submitted, the
 * ticket it released after, unless a case starts it released. */
function drawn(
  start: "Draft" | "Released" | "Refused" = "Draft",
  holding: Holding = {},
): Served {
  const deletes: string[] = [];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Succeeded",
      decidedSequence: releasedTicket.sequence,
    },
    route: (url) => {
      const released = start === "Released" || api.submitted() !== undefined;
      if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/configurations/")) return answer({}, 404);
      if (url.endsWith("/drafts/336"))
        return answer({ ...releasedDraft, ticket: 336 });
      if (url.endsWith("/tickets/336"))
        return holding.other ?? answer({ ...releasedTicket, ticket: 336 });
      if (start === "Refused" && /\/(drafts|tickets)\/335$/u.test(url))
        return answer({ error: { code: "NotFound" } }, 404);
      if (url.includes("/drafts/"))
        return answer(released ? releasedDraft : drafted);
      if (url.includes("/tickets/"))
        return released
          ? (holding.ticket ?? answer(releasedTicket))
          : answer({ error: { code: "NotFound" } }, 404);
      return answer({
        partition: atlas,
        sequence: 9,
        tickets: [releasedTicket],
      });
    },
  });
  vi.stubGlobal("fetch", (url: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") {
      deletes.push(url);
      return (
        holding.deletion ??
        Promise.resolve(answer({ ...drafted, state: "Deleted" }))
      );
    }
    return api.fetch(url, init);
  });
  const page = (): ReactNode => (
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>
  );
  const { rerender } = render(page());
  return {
    redrawn: () => {
      rerender(page());
    },
    deletes,
    submitted: api.submitted,
    drafted: (draft) => {
      client.setQueryData(draftQuery(atlas, 335, "Streamed").queryKey, draft);
    },
  };
}

function standing(): string | null | undefined {
  return ticketHeader()
    .querySelector(".ticket-header-state .ticket-state")
    ?.getAttribute("data-standing");
}

test("a draft never released draws the ticket page in Draft state, read from the draft", async () => {
  drawn();
  await settled();
  const header = ticketHeader();

  expect(standing()).toBe("Draft");
  expect(within(header).getByText("Not released")).toBeDefined();
  expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe(
    "worker: lock contract 1.36.0 #335",
  );
  expect(within(header).getByRole("button", { name: "Release" })).toBeDefined();
  expect(within(header).getByText("Edit")).toBeDefined();
  expect(screen.getByRole("navigation", { name: "Ticket" })).toBeDefined();
  expect(screen.getByText("None run yet")).toBeDefined();
  expect(screen.getByText(intent)).toBeDefined();
  const sidebar = screen.getByRole("complementary", { name: "Properties" });
  expect(
    within(sidebar).getByText("contract/thread-offer-tools"),
  ).toBeDefined();
  expect(within(sidebar).queryByText("Filed by")).toBeNull();
  expect(within(sidebar).queryByText("Cost")).toBeNull();
  expect(screen.getByText("Nothing has run")).toBeDefined();
  expect(screen.getByText("No run figures yet")).toBeDefined();
});

test("Release sends the form's own release at the version read, and the page then draws the released ticket", async () => {
  const served = drawn();
  await settled();

  await turned(() => {
    within(ticketHeader()).getByRole("button", { name: "Release" }).click();
  });
  await settled();

  expect(served.submitted()).toMatchObject({
    mutation: {
      mutation: "ReleaseDraft",
      ticket: 335,
      authoringVersion: 3,
      configurationRevision: "r6",
    },
  });

  expect(standing()).toBe("Ready");
  expect(within(ticketHeader()).queryByText("Not released")).toBeNull();
  expect(
    within(ticketHeader()).queryByRole("button", { name: "Release" }),
  ).toBeNull();
  expect(
    within(screen.getByRole("complementary", { name: "Properties" })).getByText(
      "Filed by",
    ),
  ).toBeDefined();
});

test("Delete asks first and sends nothing until its own button is pressed, then deletes at the version read and goes to the ticket list", async () => {
  const served = drawn();
  await settled();

  const item = within(await ticketHeaderMenuOpened()).getByRole("menuitem", {
    name: "Delete draft…",
  });
  await turned(() => {
    item.click();
  });
  const ask = screen.getByRole("dialog", { name: "Delete this draft?" });
  expect(served.deletes).toStrictEqual([]);

  await turned(() => {
    within(ask).getByRole("button", { name: "Delete draft" }).click();
  });
  await settled();

  expect(served.deletes).toHaveLength(1);
  expect(served.deletes[0]).toMatch(/\/drafts\/335\?expectedVersion=3$/u);
  expect(navigated.to).toStrictEqual([
    { to: "/$tenant/$project", params: atlas },
  ]);
});

test("a draft whose release is read before its ticket keeps its page until the ticket is read", async () => {
  const ticketRead = heldAnswer();
  const served = drawn("Draft", { ticket: ticketRead.answered });
  await settled();

  await turned(() => {
    within(ticketHeader()).getByRole("button", { name: "Release" }).click();
  });
  served.drafted(releasedDraft);
  await settled();

  expect(standing()).toBe("Draft");
  expect(screen.getByText("None run yet")).toBeDefined();
  expect(screen.getByText(intent)).toBeDefined();

  ticketRead.release(answer(releasedTicket));
  await settled();

  expect(standing()).toBe("Ready");
});

test("a draft whose deletion is read before the deletion answers keeps its page, and still goes to the ticket list", async () => {
  const deletion = heldAnswer();
  const served = drawn("Draft", { deletion: deletion.answered });
  await settled();

  const item = within(await ticketHeaderMenuOpened()).getByRole("menuitem", {
    name: "Delete draft…",
  });
  await turned(() => {
    item.click();
  });
  await turned(() => {
    within(screen.getByRole("dialog", { name: "Delete this draft?" }))
      .getByRole("button", { name: "Delete draft" })
      .click();
  });
  served.drafted({ ...drafted, state: "Deleted" });
  await settled();

  expect(standing()).toBe("Draft");
  expect(screen.getByText("None run yet")).toBeDefined();
  expect(screen.getByText(intent)).toBeDefined();

  deletion.release(answer({ ...drafted, state: "Deleted" }));
  await settled();

  expect(navigated.to).toStrictEqual([
    { to: "/$tenant/$project", params: atlas },
  ]);
});

test("a draft deleted by nobody on this page draws the page's not-found", async () => {
  const served = drawn();
  await settled();

  served.drafted({ ...drafted, state: "Deleted" });
  await settled();

  expect(document.querySelector('[data-standing="Draft"]')).toBeNull();
  expect(screen.getByText(/^Not found/u)).toBeDefined();
});

test("a page for one ticket never draws the draft it drew for another", async () => {
  const otherRead = heldAnswer();
  const served = drawn("Draft", { other: otherRead.answered });
  await settled();
  expect(standing()).toBe("Draft");

  addressed.ticket = "336";
  await turned(() => {
    served.redrawn();
  });
  await settled();

  expect(document.querySelector('[data-standing="Draft"]')).toBeNull();
  expect(screen.queryByText("Not released")).toBeNull();
  expect(screen.queryByRole("button", { name: "Release" })).toBeNull();
  expect(screen.queryByText(intent)).toBeNull();

  otherRead.release(answer({ ...releasedTicket, ticket: 336 }));
  await settled();

  expect(standing()).toBe("Ready");
  expect(
    within(ticketHeader()).getByRole("heading", { level: 1 }).textContent,
  ).toBe("worker: lock contract 1.36.0 #336");
});

test("a released ticket's page is its own, whatever its draft holds", async () => {
  drawn("Released");
  await settled();

  expect(standing()).toBe("Ready");
  expect(within(ticketHeader()).queryByText("Not released")).toBeNull();
  expect(screen.getByText("Revision 1", { exact: false })).toBeDefined();
  expect(
    within(await ticketHeaderMenuOpened()).queryByRole("menuitem", {
      name: "Delete draft…",
    }),
  ).toBeNull();
});

test("a reader the draft read refuses as well as the ticket read draws the page's not-found", async () => {
  drawn("Refused");
  await settled();

  expect(document.querySelector("header.ticket-header")).toBeNull();
  expect(document.querySelector('[data-standing="Draft"]')).toBeNull();
  expect(screen.getByText(/^Not found/u)).toBeDefined();
});
