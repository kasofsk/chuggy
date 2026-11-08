/**
 * Every route the console's tree declares, visited over the site: each draws
 * without throwing and without `Page failed`, every read it makes is one
 * the site has a fixture for, and no state is set during another component's
 * render. The list is the router's own, so a route added
 * to the tree is visited here without a case of its own.
 *
 * EVERY SCREEN IN A PROJECT READS THE INBOX ONCE, mounted once as a production
 * build mounts it, and none of the reads it was once joined from: the tickets
 * an inbox phase holds, the project's open actions, the lead's refusals, its
 * held decisions, or a ticket the inbox holds read on its own.
 *
 * UNDER THE PSEUDO WORDING EVERY ROUTE SAYS NOTHING BUT DATA beside the
 * catalog's altered words, in its text and in what a reader hears of it, which
 * holds the copy no lint can see. The site's fixtures are written to read as
 * data, so the check needs no list of words it allows.
 */

import { screen } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { expect, test, vi } from "vitest";

import { consoleRouterOver } from "../app/browser/routes.tsx";
import { copyPseudoLocale } from "../app/copy/copyPseudo.ts";
import { inboxProposalsPolledMs } from "../app/core/inboxProposals.ts";
import { inboxPhases } from "../../../src/contract/http.ts";
import {
  consoleAdvanced,
  consoleInboxTicket,
  consoleMounted,
  consoleRouteParameters,
  consoleSession,
  consoleSiteClean,
  consoleSiteEachCase,
} from "./consoleSite.tsx";
import type { ConsoleSite } from "./consoleSite.tsx";
import { ticketPageTicket } from "./ticketPageFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./consoleNetwork.ts")).consolePortsOver(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

let site: ConsoleSite;

consoleSiteEachCase((made) => {
  site = made;
});

/** How long a screen is given to read what it reads and draw it. */
const consoleRouteWalkSettleMs = 1_000;

/** A declared path with each parameter filled from the site's fixtures. */
function consoleRouteAddress(path: string): string {
  return path.replace(/\$([A-Za-z]+)/gu, (_whole, name: string) => {
    const value = consoleRouteParameters[name];
    if (value === undefined)
      throw new Error(`no fixture fills the parameter ${name} of ${path}`);
    return value;
  });
}

/** Every route but the root, by its own path: an index route is a route of
 * its own, though it answers its parent's address. */
const consoleRoutePaths = Object.values(
  consoleRouterOver(createMemoryHistory()).routesById,
)
  .filter((route) => !route.isRoot)
  .map((route) => route.fullPath);

test("the router declares routes for the walk to visit", () => {
  expect(consoleRoutePaths.length).toBeGreaterThan(1);
});

/** The elements whose text is data whatever it spells: code, and what is
 * marked as no words to translate, as an address is. */
const consoleRouteCode = 'code, pre, kbd, samp, [translate="no"]';

/** The attributes a reader is shown or hears beside an element's text. */
const consoleRouteAttributes = ["aria-label", "title", "placeholder"] as const;

/** Whether a word is data rather than copy: it holds no plain letter, as a
 * pseudo word or a figure does; it holds a digit or joins its letters with a
 * mark no sentence puts inside a word, as an id, a path or a name written as
 * an identifier does; or it is capitals alone, as a format's name is. */
function consoleRouteWordData(word: string): boolean {
  const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return (
    !/[A-Za-z]/u.test(bare) ||
    /\p{N}/u.test(bare) ||
    /[\p{L}\p{N}][-_/.@:#=+~][\p{L}\p{N}]/u.test(bare) ||
    /^[A-Z]{2,}$/u.test(bare)
  );
}

/** Every word a reader is shown under the pseudo wording that is neither the
 * catalog's, altered, nor data, with the text or attribute it was in. */
function consoleRoutePlain(root: HTMLElement): readonly string[] {
  const found: string[] = [];
  const said = (text: string, where: string): void => {
    const plain = text
      .split(/\s+/u)
      .filter((word) => word !== "" && !consoleRouteWordData(word));
    if (plain.length > 0) found.push(`${where} "${text.trim()}"`);
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || parent.closest(consoleRouteCode) !== null) continue;
    if (parent.closest("script, style") !== null) continue;
    said(node.textContent ?? "", "text");
  }
  for (const element of root.querySelectorAll("*"))
    for (const name of consoleRouteAttributes) {
      const value = element.getAttribute(name);
      if (value !== null) said(value, name);
    }
  return found;
}

test("the pseudo check names plain English, and passes pseudo words and data", () => {
  const drawn = document.createElement("div");
  drawn.innerHTML = [
    "<p>[Ƞḗḗẇ ŧīīƈķḗḗŧ] acme-co #42 PNG</p>",
    "<p>Billing</p>",
    '<code>npm ci</code><span translate="no">settings</span>',
    '<button aria-label="Close" title="[Ƈŀǿǿşḗḗ]"></button>',
  ].join("");
  expect(consoleRoutePlain(drawn)).toStrictEqual([
    'text "Billing"',
    'aria-label "Close"',
  ]);
});

test.each(consoleRoutePaths)(
  "%s says nothing but data outside the catalog under the pseudo wording",
  async (path) => {
    consoleMounted(
      consoleRouteAddress(path),
      consoleSession(),
      true,
      undefined,
      copyPseudoLocale,
    );
    await consoleAdvanced(consoleRouteWalkSettleMs);
    expect(
      consoleRoutePlain(document.body),
      `plain English on ${path}`,
    ).toStrictEqual([]);
  },
);

test.each(consoleRoutePaths)("%s draws over the site", async (path) => {
  consoleMounted(consoleRouteAddress(path));
  await consoleAdvanced(consoleRouteWalkSettleMs);
  expect(screen.queryByText("Page failed")).toBeNull();
  expect(screen.queryByText("Not found")).toBeNull();
  consoleSiteClean(site);
});

/** What one mount reads that the inbox is, or was once joined from. */
function consoleInboxReads(reads: readonly string[]) {
  const phased = new RegExp(`[?&]phase=(${inboxPhases.join("|")})(&|$)`, "u");
  return {
    inbox: reads.filter((read) => /\/inbox(\?|$)/u.test(read)).length,
    joined: reads.filter(
      (read) =>
        phased.test(read) ||
        /\/projects\/[^/]+\/(native-actions|selector-proposals)(\?|$)/u.test(
          read,
        ) ||
        new RegExp(`/tickets/${String(consoleInboxTicket)}(/|\\?|$)`, "u").test(
          read,
        ),
    ),
  };
}

/** The root opens the project the site lists, so it is in one too. */
test.each(consoleRoutePaths)(
  "%s reads the inbox once, and none of what it was joined from",
  async (path) => {
    consoleMounted(consoleRouteAddress(path), consoleSession(), false);
    await consoleAdvanced(consoleRouteWalkSettleMs);
    const read = consoleInboxReads(site.reads);
    expect(read.joined).toStrictEqual([]);
    const inProject = path === "/" || path.startsWith("/$tenant/$project");
    expect(read.inbox).toBe(inProject ? 1 : 0);
  },
);

/** The inbox screen draws a refused and proposed ticket and reads no refusal of its own. */
test("the inbox screen reads no refusals beside the inbox", async () => {
  consoleMounted(
    consoleRouteAddress("/$tenant/$project/inbox"),
    consoleSession(),
    false,
  );
  await consoleAdvanced(consoleRouteWalkSettleMs);
  expect(screen.getByText("Standing")).toBeDefined();
  expect(
    site.reads.filter((read) => read.includes("/agentic-refusals")),
  ).toStrictEqual([]);
});

/** No frame names a held decision, so whatever draws the inbox reads it again on the clock. */
test("a screen drawing the inbox reads it again every poll", async () => {
  consoleMounted(
    consoleRouteAddress("/$tenant/$project"),
    consoleSession(),
    false,
  );
  await consoleAdvanced(consoleRouteWalkSettleMs);
  expect(consoleInboxReads(site.reads).inbox).toBe(1);
  await consoleAdvanced(inboxProposalsPolledMs);
  expect(consoleInboxReads(site.reads).inbox).toBe(2);
});

/** A frame of each kind that can move a ticket into or out of the inbox, and
 * one that cannot, each pushed to the inbox screen with the top bar's badge
 * drawing the same key beside the panel. */
const consoleInboxFrames: readonly (readonly [
  string,
  string,
  unknown,
  number,
])[] = [
  [
    "an open action",
    "NativeAction",
    { version: 1, resource: "42", representation: { actions: [] } },
    1,
  ],
  [
    "a refusal",
    "AgenticRefusal",
    { version: 1, resource: "42", representation: null },
    1,
  ],
  [
    "a ticket the inbox holds",
    "Ticket",
    {
      version: 1,
      resource: String(consoleInboxTicket),
      representation: { ...ticketPageTicket, ticket: consoleInboxTicket },
    },
    1,
  ],
  [
    "a ticket arriving in a phase the inbox holds",
    "Ticket",
    {
      version: 1,
      resource: String(ticketPageTicket.ticket),
      representation: {
        ...ticketPageTicket,
        phase: "Escalated",
        escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
      },
    },
    1,
  ],
  [
    "a ticket the inbox neither holds nor would",
    "Ticket",
    {
      version: 1,
      resource: String(ticketPageTicket.ticket),
      representation: { ...ticketPageTicket, sequence: 43 },
    },
    0,
  ],
];

test.each(consoleInboxFrames)(
  "a frame about %s reads the inbox again that many times under the shell",
  async (_about, event, data, rereads) => {
    consoleMounted(
      consoleRouteAddress("/$tenant/$project/inbox"),
      consoleSession(),
      false,
    );
    await consoleAdvanced(consoleRouteWalkSettleMs);
    expect(screen.getByText("Standing")).toBeDefined();
    site.reads.length = 0;
    site.emit(event, data);
    await consoleAdvanced(consoleRouteWalkSettleMs);
    expect(consoleInboxReads(site.reads).inbox).toBe(rereads);
    if (rereads === 0) expect(site.reads).toStrictEqual([]);
  },
);
