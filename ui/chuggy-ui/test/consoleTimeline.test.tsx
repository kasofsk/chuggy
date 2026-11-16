/**
 * The whole console over the site, stepped through what a server does over
 * time, with a reader's text typed into each of the places a reader writes:
 * New ticket's form and the chat pane's composer, an open North Star edit and
 * the same composer, and a ticket's edit form, drawn on the ticket's own read,
 * and the same composer.
 *
 * WHAT IS ASSERTED IS WHAT HOLDS THROUGHOUT, not what a screen says. After
 * every tick of every timeline the text typed is still there, in the same
 * element it was typed into, so nothing under it was mounted again; no stream
 * banner draws while the site carries, nor before the stream has been lost
 * for the grace; and the stream has never been reopened from nowhere once it
 * had handed over a frame. Each timeline ends with the site up and the
 * console live again with no stream banner, and with the version banner
 * where the timeline answered the console in a shape it cannot read.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { act } from "react";
import { expect, test, vi } from "vitest";

import { streamGraceMs } from "../app/browser/stream.tsx";
import {
  streamBusyOpensMax,
  streamReopenDelayMsMax,
} from "../app/core/streamConnection.ts";
import {
  consoleAdvanced,
  consoleMounted,
  consolePartition,
  consoleSession,
  consoleSiteClean,
  consoleSiteEachCase,
} from "./consoleSite.tsx";
import type { ConsoleSession, ConsoleSite } from "./consoleSite.tsx";
import { threadMineSession, threadSessionResource } from "./threadFixture.ts";
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

/** How far the clock moves between two checks of what holds. */
const consoleTimelineTickMs = 1_000;

/** How long a timeline runs on after its site is whole again, for the
 * console to be live again: the reopen ladder's ceiling and a fallback
 * round, with room. */
const consoleTimelineSettleMs = 90_000;

type ConsoleBox = HTMLInputElement | HTMLTextAreaElement;

/** One place text was typed into: how it is found again, the element it was
 * typed into, and the text. */
interface ConsoleTyped {
  readonly place: string;
  readonly found: () => ConsoleBox;
  readonly element: ConsoleBox;
  readonly text: string;
}

function consoleTypedInto(
  place: string,
  found: () => ConsoleBox,
  text: string,
): ConsoleTyped {
  const element = found();
  fireEvent.change(element, { target: { value: text } });
  return { place, found, element, text };
}

function consoleComposer(): ConsoleBox {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

/** A screen at an address, and the places on it a reader types into. */
interface ConsoleDesk {
  readonly name: string;
  readonly path: string;
  readonly typed: () => Promise<readonly ConsoleTyped[]>;
}

const projectAddress = `/${consolePartition.tenant}/${consolePartition.project}`;

function consoleTicketForm(): ConsoleBox {
  return screen.getByPlaceholderText<HTMLTextAreaElement>(
    "what this ticket is for",
  );
}

const consoleDesks: readonly ConsoleDesk[] = [
  {
    name: "New ticket's form and the composer",
    path: `${projectAddress}/tickets/new`,
    typed: () =>
      Promise.resolve([
        consoleTypedInto(
          "New ticket's form",
          consoleTicketForm,
          "a ticket the reader is writing",
        ),
        consoleTypedInto(
          "the composer",
          consoleComposer,
          "a message the reader is writing",
        ),
      ]),
  },
  {
    name: "an open North Star edit and the composer",
    path: `${projectAddress}/settings/lead`,
    typed: async () => {
      await act(async () => {
        fireEvent.click(
          within(
            screen.getByRole("region", { name: /^North Star/u }),
          ).getByRole("button", { name: "Edit" }),
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      return [
        consoleTypedInto(
          "the North Star edit",
          () =>
            screen.getByRole<HTMLTextAreaElement>("textbox", {
              name: "North Star",
            }),
          "a North Star the reader is writing",
        ),
        consoleTypedInto(
          "the composer",
          consoleComposer,
          "a message the reader is writing",
        ),
      ];
    },
  },
  {
    name: "the ticket's edit form and the composer",
    path: `${projectAddress}/tickets/${String(ticketPageTicket.ticket)}/edit`,
    typed: () =>
      Promise.resolve([
        consoleTypedInto(
          "the ticket's edit form",
          consoleTicketForm,
          "a revision the reader is writing",
        ),
        consoleTypedInto(
          "the composer",
          consoleComposer,
          "a message the reader is writing",
        ),
      ]),
  },
];

/** What the version banner is headed, which is no account of the stream. */
const consoleVersionHeading = "New version";

/** The heading of each banner the shell draws. */
function consoleBanners(): readonly string[] {
  const banner = document.querySelector(".shell-banner");
  if (banner === null) throw new Error("no shell is drawn to hold a banner");
  return [...banner.querySelectorAll(".notice-head")].map(
    (heading) => heading.textContent,
  );
}

function consoleStreamBanners(): readonly string[] {
  return consoleBanners().filter(
    (heading) => heading !== consoleVersionHeading,
  );
}

/** What holds after every step of every timeline. */
function consoleHeld(typed: readonly ConsoleTyped[]): void {
  for (const held of typed) {
    expect(held.found(), `${held.place} is the element typed into`).toBe(
      held.element,
    );
    expect(held.element.value, `${held.place} keeps its text`).toBe(held.text);
  }
  const lostAtMs = site.carryingLostAtMs();
  if (lostAtMs === undefined || Date.now() - lostAtMs < streamGraceMs)
    expect(consoleStreamBanners(), "no banner inside the grace").toEqual([]);
  expect(site.cursorsDropped, "no reopen from nowhere").toEqual([]);
}

/** The clock moved on by `ms` a tick at a time, what holds checked at each
 * and once before the first, so what a step does in the instant it is taken
 * is seen before a reopen covers it. */
async function consoleWalked(
  ms: number,
  typed: readonly ConsoleTyped[],
): Promise<void> {
  await consoleAdvanced(0);
  consoleHeld(typed);
  for (let walkedMs = 0; walkedMs < ms; walkedMs += consoleTimelineTickMs) {
    await consoleAdvanced(consoleTimelineTickMs);
    consoleHeld(typed);
  }
}

/** What a server does over time, against text the reader has typed. */
interface ConsoleTimeline {
  readonly name: string;
  readonly renewEveryMs?: number;
  /** Whether the console is answered in a shape it cannot read. */
  readonly outdates?: boolean;
  readonly run: (
    walked: (ms: number) => Promise<void>,
    session: ConsoleSession,
  ) => Promise<void>;
}

/** Every read of the project's own, which a failed background read fails. */
const consoleProjectReads = new RegExp(
  `^/api/v1/tenants/${consolePartition.tenant}/projects/${consolePartition.project}(/|$)`,
  "u",
);

const consoleTimelines: readonly ConsoleTimeline[] = [
  {
    name: "one failed background read",
    run: async (walked) => {
      site.failing = consoleProjectReads;
      site.emit("Project", {
        version: 1,
        resource: consolePartition.project,
        representation: consolePartition,
      });
      await walked(15_000);
      site.failing = undefined;
      await walked(15_000);
    },
  },
  {
    name: "a fallback round during an outage",
    run: async (walked) => {
      site.up = false;
      site.cut();
      await walked(2 * streamGraceMs + 20_000);
      site.up = true;
    },
  },
  {
    name: "a routine stream close at 300 s",
    run: async (walked) => {
      await walked(300_000);
      site.close();
      await walked(30_000);
    },
  },
  {
    name: "a token renewal",
    renewEveryMs: 60_000,
    run: async (walked, session) => {
      await walked(30_000);
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: { ...ticketPageTicket, sequence: 43 },
      });
      await walked(100_000);
      expect(session.renewals()).toBeGreaterThan(1);
    },
  },
  {
    name: "a tombstone frame",
    run: async (walked) => {
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: null,
      });
      site.emit("Configuration", {
        version: 1,
        resource: "n-development",
        representation: null,
      });
      site.emit("Session", {
        version: 1,
        resource: threadSessionResource(threadMineSession, "turn-1"),
        representation: null,
      });
      await walked(15_000);
    },
  },
  /** The new API logged a frame of a kind this console does not know while
   * it was down, which the reopen replays from the console's cursor. */
  {
    name: "a redeploy: 503s for 30 s, then a new API",
    outdates: true,
    run: async (walked) => {
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: { ...ticketPageTicket, sequence: 43 },
      });
      await walked(consoleTimelineTickMs);
      site.up = false;
      site.cut();
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: { ...ticketPageTicket, sequence: 44 },
      });
      site.emit("Workflow", { version: 1, resource: "w-1" });
      await walked(30_000);
      site.up = true;
    },
  },
  /** Every answer names a wait no longer than the ladder's ceiling, so an
   * outage of that many ceilings outlasts the opens the ladder would bound. */
  {
    name: "an outage that spends the stream's bound, then a new API",
    run: async (walked) => {
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: { ...ticketPageTicket, sequence: 43 },
      });
      await walked(consoleTimelineTickMs);
      site.up = false;
      site.cut();
      const opensBefore = site.stream.headersSeen.length;
      site.emit("Ticket", {
        version: 1,
        resource: String(ticketPageTicket.ticket),
        representation: { ...ticketPageTicket, sequence: 44 },
      });
      await walked(streamBusyOpensMax * streamReopenDelayMsMax);
      expect(
        site.stream.headersSeen.length - opensBefore,
        "opens the outage refused",
      ).toBeGreaterThanOrEqual(streamBusyOpensMax);
      site.up = true;
    },
  },
];

const consoleCases = consoleTimelines.flatMap((timeline) =>
  consoleDesks.map((desk) => ({ timeline, desk })),
);

test.each(consoleCases)(
  "$timeline.name, over $desk.name",
  async ({ timeline, desk }) => {
    const session = consoleSession(timeline.renewEveryMs);
    consoleMounted(desk.path, session);
    await consoleAdvanced(consoleTimelineTickMs);
    const typed = await desk.typed();
    consoleHeld(typed);
    const walked = (ms: number): Promise<void> => consoleWalked(ms, typed);
    await timeline.run(walked, session);
    await walked(consoleTimelineSettleMs);
    expect(
      document.querySelector("[data-stream]")?.getAttribute("data-stream"),
    ).toBe("live");
    expect(consoleBanners()).toEqual(
      timeline.outdates === true ? [consoleVersionHeading] : [],
    );
    consoleSiteClean(site);
  },
);
