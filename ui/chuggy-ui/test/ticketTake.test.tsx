/**
 * Take and Return on a ticket's header, and the owner in its sidebar: Take is
 * offered to a reader who may mutate and does not own the ticket, Return to
 * its taker, neither to a creator who owns their own ticket or to a reader
 * refused the permit, and a press names nobody but the reader.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode, Ref } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  scriptedFetch,
  settled,
  queryClientUnretried,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { abilitiesEvery } from "./projectAbilitiesFixture.ts";
import { creatorLabel } from "../app/core/labels.ts";
import type { ProjectAbilitiesResponse } from "../../../src/contract/responses.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { TicketPageEveryTab, ticketHeader } from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => new Promise<void>(() => undefined),
}));

interface LinkStub {
  readonly ref?: Ref<HTMLAnchorElement>;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => {
  const stub = (props: LinkStub) => (
    <a href="/" ref={props.ref}>
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

const reader = abilitiesEvery.principal;
const other = "issuer other";

interface TakeCase {
  readonly phase?: TicketPhase;
  readonly creator: string;
  readonly owner: string;
  readonly abilities?: ProjectAbilitiesResponse;
  /** What the ticket reads as once a take or a return has landed. */
  readonly ownerAfter?: string;
}

/** The ticket page as `drawn` has it, every request it sends kept. */
async function page(drawn: TakeCase): Promise<readonly SentRequest[]> {
  let owner = drawn.owner;
  const ticket = () => ({
    ticket: 11,
    phase: drawn.phase ?? "Pending",
    sequence: 7,
    creator: drawn.creator,
    owner,
    ...ticketInstants,
  });
  const api = scriptedFetch((request) => {
    const url = request.url;
    if (url.endsWith("/abilities"))
      return answer(drawn.abilities ?? abilitiesEvery);
    if (
      url.endsWith("/tickets/11/take") ||
      url.endsWith("/tickets/11/return")
    ) {
      owner = drawn.ownerAfter ?? owner;
      return answer({ outcome: "Taken", owner });
    }
    if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
    if (url.includes("/native-actions")) return answer({ actions: [] });
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/landing-queues"))
      return answer({ queues: [], truncated: false });
    if (url.includes("/landings"))
      return answer({ landings: [], truncated: false });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(ticket());
    return answer({ partition: atlas, sequence: 7, tickets: [ticket()] });
  });
  vi.stubGlobal("fetch", api.fetch);
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={queryClientUnretried()}
      transport={openedStream().ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>,
  );
  await settled();
  return api.sent;
}

/** Which of Take and Return the header draws. */
function offered(): readonly string[] {
  return ["Take", "Return"].filter(
    (name) => within(ticketHeader()).queryByRole("button", { name }) !== null,
  );
}

/** The sidebar's Owner, as drawn, or nothing where it draws none. */
function ownerDrawn(): string | undefined {
  const sidebar = screen.getByRole("complementary", { name: "Properties" });
  const name = within(sidebar)
    .queryAllByRole("term")
    .find((term) => term.textContent === "Owner");
  return name?.nextElementSibling?.textContent ?? undefined;
}

test("a reader who owns the ticket they filed is offered neither, and no owner is drawn", async () => {
  await page({ creator: reader, owner: reader });
  expect(offered()).toStrictEqual([]);
  expect(ownerDrawn()).toBeUndefined();
});

test("the ticket's taker is offered Return, and is drawn its owner", async () => {
  await page({ creator: other, owner: reader });
  expect(offered()).toStrictEqual(["Return"]);
  expect(ownerDrawn()).toBe(creatorLabel(reader).text);
});

test("a reader who neither filed nor took the ticket is offered Take", async () => {
  await page({ creator: other, owner: other });
  expect(offered()).toStrictEqual(["Take"]);
  expect(ownerDrawn()).toBeUndefined();
});

test("a reader who does not own a ticket someone else took is offered Take, and never Return", async () => {
  await page({ creator: reader, owner: other });
  expect(offered()).toStrictEqual(["Take"]);
  expect(ownerDrawn()).toBe(creatorLabel(other).text);
});

test("a reader without the permit to mutate is offered neither", async () => {
  await page({
    creator: other,
    owner: reader,
    abilities: { ...abilitiesEvery, mutate: false },
  });
  expect(offered()).toStrictEqual([]);
  cleanup();
  await page({
    creator: other,
    owner: other,
    abilities: { ...abilitiesEvery, mutate: false },
  });
  expect(offered()).toStrictEqual([]);
});

test.each(["Done", "Revoked"] as const)(
  "a %s ticket offers neither, to its taker or anyone else",
  async (phase) => {
    await page({ phase, creator: other, owner: reader });
    expect(offered()).toStrictEqual([]);
    cleanup();
    await page({ phase, creator: other, owner: other });
    expect(offered()).toStrictEqual([]);
  },
);

test("Take posts to the ticket's take door with no member named, and the ticket read again draws Return", async () => {
  const sent = await page({ creator: other, owner: other, ownerAfter: reader });
  await turned(() => {
    fireEvent.click(
      within(ticketHeader()).getByRole("button", { name: "Take" }),
    );
  });
  await settled();
  const takes = sent.filter((request) => request.url.endsWith("/take"));
  expect(takes.map(({ method, body }) => ({ method, body }))).toStrictEqual([
    { method: "POST", body: {} },
  ]);
  expect(offered()).toStrictEqual(["Return"]);
  expect(ownerDrawn()).toBe(creatorLabel(reader).text);
});
