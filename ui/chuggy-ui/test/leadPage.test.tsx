/**
 * The lead page: where the session stands, what its mailbox measured, what it
 * currently holds, and whether all of that moves when a turn does.
 *
 * THE LIVE CASE IS THE ONE WITH TEETH. The lead read is the `Session` frame's
 * own body, so a frame both rewrites the head and raises the batch count the
 * transcript walks to; a page that did not fold the kind would sit on the turn
 * and the entries it opened with while the lead went on deciding, and would
 * look exactly like a page with nothing to report.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadPage } from "../app/browser/LeadPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import { sessionStorePageBatchesMax } from "../../../src/contract/http.ts";
import { leadTranscriptReadsMax } from "../app/core/leadTranscript.ts";
import {
  leadBody,
  leadHandoffNote,
  leadPartition,
  leadRefusals,
  leadRouteAnswer,
  leadSession,
} from "./leadFixture.ts";
import type { LeadServed } from "./leadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page under its providers, over whatever fetch the case has stubbed. */
async function mountLead(): Promise<ReturnType<typeof openedStream>> {
  const server = openedStream();
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <LeadPage />
    </ScreenHarness>,
  );
  await settled();
  return server;
}

/** The page over a server answering every route from one held state. */
async function drawLead(
  holding: () => LeadServed,
): Promise<ReturnType<typeof openedStream>> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const found = leadRouteAnswer(url, holding());
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  return mountLead();
}

const opening: LeadServed = {
  batches: 2,
  turns: 1,
  refusals: leadRefusals(false),
};

/** The rows of the Holding panel alone, the decision log drawing rows of its
 * own under the same primitive. */
function holdingEntries(): readonly string[] {
  const panel = screen
    .getByRole("heading", { name: "Holding" })
    .closest(".panel");
  return [...(panel?.querySelectorAll(".ledger-row .ledger-label") ?? [])].map(
    (label) => label.textContent ?? "",
  );
}

function logLines(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".lead-log > li")];
}

test("the head names the session, its state and the cursor it stands on", async () => {
  await drawLead(() => opening);
  expect(screen.getByRole("heading", { name: "Lead" })).toBeDefined();
  expect(screen.getAllByText(leadSession).length).toBeGreaterThan(0);
  expect(screen.getByText("Open")).toBeDefined();
  expect(screen.getByText("Monitoring")).toBeDefined();
  expect(screen.getByText("1204")).toBeDefined();
});

test("the mailbox tail draws what the pod measured of each turn", async () => {
  await drawLead(() => opening);
  expect(screen.getByText("claude-opus-4")).toBeDefined();
  expect(screen.getByText("Answered")).toBeDefined();
  expect(screen.getByText("52k")).toBeDefined();
  expect(screen.getByText("$0.21")).toBeDefined();
});

/**
 * The Holding panel's whole claim. The store read carries four entries and the
 * lead holds the two from the compaction boundary on, so a page that drew the
 * read as the held would put two conversations the lead has forgotten in front
 * of a reader as what it is working from.
 */
test("what the lead holds is a marked subset of the log and not the whole of it", async () => {
  await drawLead(() => opening);
  expect(holdingEntries()).toStrictEqual(["Entry 3", "Entry 4"]);
  expect(logLines().length).toBe(5);
});

/** The seam sits above the entry the compaction cut at, so the entries below it
 * read as gone and the ones after it as held. */
test("the seam is drawn once, above the boundary entry and nowhere else", async () => {
  await drawLead(() => opening);
  const lines = logLines();
  const seams = lines.flatMap((line, at) =>
    line.className === "lead-seam" ? [at] : [],
  );
  expect(seams).toStrictEqual([2]);
  expect(lines[3]?.dataset["holding"]).toBe("true");
  expect(lines[0]?.dataset["holding"]).toBeUndefined();
});

test("a project with no lead is a page saying so, not five empty panels", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) =>
      url.includes("/lead")
        ? answer({ error: { code: "NotFound", message: "no" } }, 404)
        : answer({ partition: leadPartition, sequence: 1, tickets: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(screen.getByRole("heading", { name: "No lead" })).toBeDefined();
});

/**
 * A turn moving arrives as a `Session` frame carrying the lead's own body, and
 * the transcript follows it because the batch count it walks to is in that
 * body. A page not folding the kind stays on the turn and the entries it
 * opened with.
 */
test("a Session frame moves the turn tail and walks the transcript on", async () => {
  let served: LeadServed = opening;
  const server = await drawLead(() => served);
  expect(logLines().length).toBe(5);
  served = { ...opening, batches: 3, turns: 2 };
  await turned(() => {
    server.push(
      frame("Session", "40", {
        version: 1,
        resource: leadSession,
        representation: leadBody(3, 2),
      }),
    );
  });
  await settled();
  expect(screen.getByText("third decision")).toBeDefined();
  expect(logLines().length).toBe(6);
  expect(holdingEntries()).toStrictEqual(["Entry 3", "Entry 4", "Entry 5"]);
});

/**
 * The lead read carries the note's size and as much of it as one wire body has
 * room for, never the note itself. A page that drew the object as it stands
 * would put `[object Object]` where the successor's whole context is meant to
 * be, and would say nothing about the part it is not showing.
 */
test("the handoff note is drawn as its preview, marked where it is cut", async () => {
  await drawLead(() => ({ ...opening, note: leadHandoffNote(true) }));
  expect(screen.getByText("Handoff note")).toBeDefined();
  expect(screen.getByText("watch ticket 41")).toBeDefined();
  expect(screen.getByText("9000")).toBeDefined();
  expect(screen.getByText("Truncated")).toBeDefined();
});

test("a note the read carried whole is drawn with no Truncated mark", async () => {
  await drawLead(() => opening);
  expect(screen.getByText("watch ticket 41")).toBeDefined();
  expect(screen.queryByText("Truncated")).toBeNull();
});

/** A lead that has left no note has nothing to draw, and a zero-byte preview
 * drawn as an empty block would read as a note that says nothing. */
test("a lead that has left no note draws no note at all", async () => {
  await drawLead(() => ({
    ...opening,
    note: { bytes: 0, preview: "", truncated: false },
  }));
  expect(screen.queryByText("Handoff note")).toBeNull();
});

/** A store that never says it is finished, so the walk's own budget is the only
 * thing that stops it. */
function endlessStore(): { readonly reads: () => number } {
  let reads = 0;
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript")) {
        const asked = Number(
          new URL(url, "https://console").searchParams.get("after") ?? "0",
        );
        reads += 1;
        return answer({
          stream: "1a2b3c",
          entries: [
            {
              uuid: `uuid-${String(asked)}`,
              type: "assistant",
              message: { content: [] },
            },
          ],
          held: [],
          elided: 0,
          truncated: false,
          nextAfter: asked + 1,
        });
      }
      const found = leadRouteAnswer(url, { ...opening, batches: 9_999 });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  return { reads: () => reads };
}

/**
 * The read budget is the only thing between a lead whose store keeps answering
 * and a tab that walks it forever, and its size is part of the control: a bound
 * raised past what the route itself pages in is a budget that no longer bounds
 * anything a reader waits on.
 */
test("the walk stops at its own read budget however much the store offers", async () => {
  const store = endlessStore();
  await mountLead();
  expect(store.reads()).toBe(leadTranscriptReadsMax);
  expect(
    leadTranscriptReadsMax,
    "one rise of the store may now cost more reads than the route pages in",
  ).toBeLessThanOrEqual(sessionStorePageBatchesMax);
});

/** A transcript that will not read is said as itself; a Log drawn as empty
 * beside a lead that has plainly been deciding is the reading a reader would
 * take from silence. */
test("a transcript read that failed says so rather than drawing an empty log", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript"))
        return answer({ error: { code: "InternalError", message: "no" } }, 500);
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(
    screen.getByText(/^Failed · /u),
    "a transcript that could not be read was drawn as a log with nothing in it",
  ).toBeDefined();
});

/** A reference the bounded stream listing does not carry has nothing to walk,
 * and saying "No entries" would report that as a lead that has said nothing. */
test("a stream the store's listing does not carry is named, not drawn as empty", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript"))
        return answer({
          stream: "1a2b3c",
          entries: [],
          held: [],
          elided: 0,
          truncated: false,
        });
      if (url.includes("/lead"))
        return answer({ ...leadBody(0, 1), streams: [] });
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(
    screen.getAllByText("Stream unlisted").length,
    "a panel drawing a stream nothing can be read for said nothing about it",
  ).toBe(2);
  expect(screen.queryByText("No entries")).toBeNull();
  expect(screen.queryByText("Nothing held")).toBeNull();
});
