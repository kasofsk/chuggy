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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadPage } from "../app/browser/LeadPage.tsx";
import { useShellSlotsFilled } from "../app/browser/shell/slots.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { ShellSlotHarness, styleless } from "./shellSlotHarness.tsx";
import { frame } from "./streamDouble.ts";
import { viewportAtEm } from "./viewport.ts";
import { inquiryBoxesHeld } from "../app/browser/lead/inquiryBoxes.ts";
import { sessionStorePageBatchesMax } from "../../../src/contract/http.ts";
import {
  leadTranscriptEntriesHeldMax,
  leadTranscriptReadsMax,
} from "../app/core/leadTranscript.ts";
import {
  leadBody,
  leadHandoffNote,
  leadInquiry,
  leadPartition,
  leadRefusals,
  leadRouteAnswer,
  leadSession,
  leadSessionResource,
  leadStream,
  leadUnstarted,
} from "./leadFixture.ts";
import type { LeadServed } from "./leadFixture.ts";
import type { LeadInquiriesResponse } from "../../../src/contract/responses.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
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
  useParams: () => ({ ...drawnPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** Which project the router says this page is for, which a case moves the way a
 * params-only navigation does. */
let drawnPartition = { ...leadPartition };

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  inquiryBoxesHeld.discard();
  vi.unstubAllGlobals();
  drawnPartition = { ...leadPartition };
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
      <ShellSlotHarness>
        <LeadPage />
      </ShellSlotHarness>
    </ScreenHarness>,
  );
  await settled();
  styleless();
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
  batches: 3,
  turns: 1,
  refusals: leadRefusals(false),
};

/** The flag `openFirst` sets, read beside the page: the fake slot sinks draw a
 * filled details slot's content whether or not the real pane would show it, so
 * a case reads the flag itself rather than the details' presence in the DOM. */
function DetailsOpenProbe(): ReactNode {
  return <p>details {useShellSlotsFilled().detailsOpen ? "open" : "closed"}</p>;
}

/** The page at a given width, with `DetailsOpenProbe` beside it. */
async function drawLeadAtEm(
  em: number,
  holding: () => LeadServed,
): Promise<void> {
  viewportAtEm(em);
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const found = leadRouteAnswer(url, holding());
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <ShellSlotHarness>
        <DetailsOpenProbe />
        <LeadPage />
      </ShellSlotHarness>
    </ScreenHarness>,
  );
  await settled();
}

/** How many exchanges the conversation surface drew: each holds one ask
 * message, whichever half of it is empty. */
function exchangeCount(): number {
  return document.querySelectorAll('[data-message-id$="-ask"]').length;
}

/** Each question, read off the one `<p>` its own listitem holds, scoped to
 * the inquiries panel since the refusals ledger draws listitems of its own. */
function inquiryQuestions(): readonly string[] {
  const section = screen
    .getByRole("heading", { name: "Inquiries" })
    .closest("section");
  return within(section as HTMLElement)
    .queryAllByRole("listitem")
    .map((row) => row.querySelector("p")?.textContent ?? "");
}

test("the head names the session, its state and the cursor it stands on", async () => {
  await drawLead(() => opening);
  expect(screen.getByRole("heading", { name: "Lead" })).toBeDefined();
  expect(screen.getByText("Open")).toBeDefined();
  expect(screen.getByText("Monitoring")).toBeDefined();
  expect(screen.getByText("1204")).toBeDefined();
});

/** Below the desk width an open details pane would replace the page a reader
 * came here to see, so `openFirst` starts it closed there — the toggle is
 * still the reader's to press. */
test("openFirst leaves the details closed under the desk width", async () => {
  await drawLeadAtEm(40, () => opening);
  expect(screen.getByText("details closed")).toBeDefined();
});

test("openFirst opens the details at the desk width", async () => {
  await drawLeadAtEm(viewportDeskEm, () => opening);
  expect(screen.getByText("details open")).toBeDefined();
});

/** The bar's own title never wraps, so a narrow reader needs its chips to run
 * onto a line of their own rather than under the details toggle. */
test("the bar's chips wrap on their own rather than crowd the title", async () => {
  await drawLead(() => opening);
  const chips = screen.getByRole("heading", {
    name: "Lead",
  }).nextElementSibling;
  expect(chips?.className).toContain("flex-wrap");
});

test("the mailbox tail draws what the pod measured of each turn", async () => {
  await drawLead(() => opening);
  const turns = screen
    .getByRole("heading", { name: "Turns" })
    .closest("section");
  expect(within(turns as HTMLElement).getByText("claude-opus-4")).toBeDefined();
  expect(within(turns as HTMLElement).getByText("Answered")).toBeDefined();
  expect(within(turns as HTMLElement).getByText("52k")).toBeDefined();
  expect(within(turns as HTMLElement).getByText("$0.21")).toBeDefined();
});

/**
 * The transcript's own chain is the conversation's spine: a user entry opens
 * an exchange and the assistant entries that follow it are the exchange's
 * answer, so the store's four batches of this fixture draw as three exchanges
 * rather than one bubble per entry.
 */
test("the transcript's entries draw as exchanges", async () => {
  await drawLead(() => opening);
  expect(screen.getByText("an observation before the cut")).toBeDefined();
  expect(screen.getByText("first observation")).toBeDefined();
  expect(screen.getByText("compaction summary")).toBeDefined();
  expect(exchangeCount()).toBe(3);
});

/** The seam stands once, above the exchange the compaction boundary opened. */
test("a compaction draws its divider", async () => {
  await drawLead(() => opening);
  expect(screen.getAllByText("Compaction").length).toBe(1);
});

/** Everything between the ask and the answer sits behind one collapsed line,
 * and a tool call inside it opens on its own arguments and result. */
test("a tool call sits inside the collapsed work disclosure", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript")) {
        const asked = new URL(url, "https://console").searchParams.get("after");
        if (asked !== null && asked !== "0")
          return answer({
            stream: leadStream,
            entries: [],
            held: [],
            elided: 0,
            truncated: false,
          });
        return answer({
          stream: leadStream,
          entries: [
            {
              uuid: "uuid-a",
              type: "user",
              message: { content: [{ type: "text", text: "check the build" }] },
            },
            {
              uuid: "uuid-b",
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "call-1",
                    name: "Read",
                    input: { path: "ThreadPage.tsx" },
                  },
                  {
                    type: "tool_result",
                    tool_use_id: "call-1",
                    content: "bytes",
                  },
                ],
              },
            },
          ],
          held: [],
          elided: 0,
          truncated: false,
        });
      }
      const found = leadRouteAnswer(url, { ...opening, batches: 1 });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  const trigger = screen.getByRole("button", { name: /tool/ });
  expect(screen.queryByText("bytes")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.queryByText("bytes")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Read/ }));
  expect(screen.getByText("bytes")).toBeDefined();
});

/** A turn nobody has claimed appends a running exchange that draws its kind
 * word and no text — the lead's mailbox carries no input of its own. */
test("a Queued lead turn appends a running exchange with the kind word and no text", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript"))
        return answer({
          stream: leadStream,
          entries: [],
          held: [],
          elided: 0,
          truncated: false,
        });
      if (
        url.includes("/lead") &&
        !url.includes("/transcript") &&
        !url.includes("/inquiries")
      )
        return answer({
          session: leadSession,
          state: "Open",
          attention: "Monitoring",
          agentReference: leadStream,
          notificationCursor: 1,
          handoffNote: { bytes: 0, preview: "", truncated: false },
          turns: [
            {
              turn: "turn-1",
              ordinal: 1,
              inputKind: "Observation",
              state: "Queued",
            },
          ],
          streams: [{ stream: leadStream, batches: 1 }],
        });
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(exchangeCount()).toBe(1);
  const conversation = screen.getByRole("region", { name: "Conversation" });
  expect(within(conversation).getByText("Observation")).toBeDefined();
  expect(within(conversation).getByText("Queued")).toBeDefined();
});

/** One state, one word. A lead with no store yet says so once. */
test("a lead with no store says so", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead") && !url.includes("/transcript"))
        return answer(leadUnstarted());
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(screen.getByText("No store")).toBeDefined();
  expect(screen.queryByText("Stream unlisted")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Ask" }),
    "a lead with no head to fork from was offered a question anyway",
  ).toBeNull();
});

/** A read the route could not decide the held set for is not a lead that has
 * forgotten everything; it is the server saying it could not tell. */
test("a read that could not decide what is held says so, not nothing held", async () => {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript"))
        return answer({
          stream: leadStream,
          entries: [{ uuid: "uuid-a", type: "user", message: { content: [] } }],
          elided: 0,
          truncated: true,
        });
      const found = leadRouteAnswer(url, { ...opening, batches: 1 });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(screen.getByText("Not reached")).toBeDefined();
  expect(screen.queryByText("No conversation")).toBeNull();
  expect(
    screen.queryByText("Truncated"),
    "an undecided held set was also drawn as a short page",
  ).toBeNull();
});

/** A project holds a session per thread beside its lead, so a page watching one
 * must not re-read on another's frame. */
test("a Session frame naming another session leaves the page alone", async () => {
  let served: LeadServed = opening;
  const server = await drawLead(() => served);
  expect(exchangeCount()).toBe(3);
  served = { ...opening, batches: 4, turns: 2 };
  await turned(() => {
    server.push(
      frame("Session", "41", {
        version: 1,
        resource: leadSessionResource("session-elsewhere", "turn-2"),
        representation: null,
      }),
    );
  });
  await settled();
  expect(
    exchangeCount(),
    "another session's frame re-read this lead's page",
  ).toBe(3);
});

/**
 * A READ THAT FAILED MUST STILL BE WOKEN BY THE FRAME THAT SAYS TO TRY AGAIN.
 * The session a page watches is learnt from the read, so a panel that forgot it
 * whenever the read was not ready would sit on its own failure until the query
 * cache chose to retry — with the stream carrying the news the whole time.
 */
test("a lead whose read failed is still woken by its own Session frame", async () => {
  let failing = false;
  let reads = 0;
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const lead = url.includes("/lead") && !url.includes("/transcript");
      if (lead) reads += 1;
      if (lead && failing)
        return answer({ error: { code: "InternalError", message: "no" } }, 500);
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = await mountLead();
  expect(screen.getByRole("heading", { name: "Lead" })).toBeDefined();
  failing = true;
  const woken = async (id: string): Promise<number> => {
    const before = reads;
    await turned(() => {
      server.push(
        frame("Session", id, {
          version: 1,
          resource: leadSessionResource(leadSession, `turn-${id}`),
          representation: null,
        }),
      );
    });
    await settled();
    return reads - before;
  };
  expect(await woken("43")).toBeGreaterThan(0);
  expect(screen.getByText(/^Failed to load · /u)).toBeDefined();
  expect(
    await woken("44"),
    "a panel whose read had already failed was deaf to the next frame",
  ).toBeGreaterThan(0);
});

/** A resource this console cannot read is a frame it ignores, rather than one
 * that ends the stream and stops every other kind with it. */
test("a Session frame with a resource this console cannot read is ignored", async () => {
  let served: LeadServed = opening;
  const server = await drawLead(() => served);
  served = { ...opening, batches: 4, turns: 2 };
  await turned(() => {
    server.push(
      frame("Session", "42", {
        version: 1,
        resource: leadSession,
        representation: null,
      }),
    );
  });
  await settled();
  expect(exchangeCount()).toBe(3);
  expect(screen.queryByText(/^Failed · /u)).toBeNull();
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
  expect(exchangeCount()).toBe(3);
  served = { ...opening, batches: 4, turns: 2 };
  await turned(() => {
    server.push(
      frame("Session", "40", {
        version: 1,
        resource: leadSessionResource(leadSession, "turn-2"),
        representation: null,
      }),
    );
  });
  await settled();
  expect(screen.getByText(/third decision/)).toBeDefined();
  expect(
    exchangeCount(),
    "an assistant entry with no ask ahead of it opened a bubble of its own",
  ).toBe(3);
});

/**
 * THE TWO PANELS ON THIS PAGE DIVIDE ONE KIND'S FRAMES: the lead's panels
 * follow the session they name, and the inquiries panel follows the kind.
 * A page whose lead predicate had been widened to cover the inquiries would
 * re-read the head, the mailbox tail and the transcript walk on every question.
 */
test("the lead's own frame moves the lead alone, and an inquiry's the inquiries", async () => {
  const asking = (at: number): LeadInquiriesResponse => ({
    inquiries: [leadInquiry(at, { turnState: "Queued" })],
  });
  let served: LeadServed = { ...opening, inquiries: asking(1) };
  const server = await drawLead(() => served);
  expect(exchangeCount()).toBe(3);
  expect(inquiryQuestions()).toStrictEqual(["question 1"]);
  served = { ...served, batches: 4, turns: 2, inquiries: asking(2) };
  await turned(() => {
    server.push(
      frame("Session", "80", {
        version: 1,
        resource: leadSessionResource(leadSession, "turn-2"),
        representation: null,
      }),
    );
  });
  await settled();
  expect(screen.getByText(/third decision/)).toBeDefined();
  expect(
    inquiryQuestions(),
    "the lead's own frame re-read the inquiries beside it",
  ).toStrictEqual(["question 1"]);
  served = { ...served, batches: 5, turns: 3, inquiries: asking(3) };
  await turned(() => {
    server.push(
      frame("Session", "81", {
        version: 1,
        resource: leadSessionResource("inq-9", "turn-1", "Inquiry"),
        representation: null,
      }),
    );
  });
  await settled();
  expect(inquiryQuestions()).toStrictEqual(["question 3"]);
  expect(
    exchangeCount(),
    "an inquiry's frame re-read the lead's own panels",
  ).toBe(3);
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
  expect(screen.getByText("9000")).toBeDefined();
  expect(screen.getByText("Truncated")).toBeDefined();
  expect(screen.queryByText("watch ticket 41")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Handoff note/ }));
  expect(screen.getByText("watch ticket 41")).toBeDefined();
});

test("a note the read carried whole is drawn with no Truncated mark", async () => {
  await drawLead(() => opening);
  expect(screen.queryByText("Truncated")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Handoff note/ }));
  expect(screen.getByText("watch ticket 41")).toBeDefined();
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
 * and saying "No conversation" would report that as a lead that has said
 * nothing. */
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
      if (url.includes("/lead") && !url.includes("/inquiries"))
        return answer({ ...leadBody(0, 1), streams: [] });
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  await mountLead();
  expect(screen.getByText("Stream unlisted")).toBeDefined();
  expect(screen.queryByText("No conversation")).toBeNull();
});

/**
 * A store whose `cut` moves on the last read the budget allows, which is the
 * reachable worst case: the walk ends on the reset and no re-walk page arrives
 * to replace it.
 */
function compactingStore(moveOnRead: number): { readonly reads: () => number } {
  let reads = 0;
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript")) {
        const asked = Number(
          new URL(url, "https://console").searchParams.get("after") ?? "0",
        );
        reads += 1;
        const cut = reads >= moveOnRead ? 9 : 1;
        return answer({
          stream: leadStream,
          entries: [
            {
              uuid: `uuid-${String(asked)}`,
              type: "assistant",
              message: { content: [] },
            },
          ],
          held: [`uuid-${String(asked)}`],
          cut,
          elided: 0,
          truncated: false,
          nextAfter: asked + 1,
        });
      }
      const found = leadRouteAnswer(url, { ...opening, batches: 40 });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  return { reads: () => reads };
}

/**
 * THE RESET IS A STEP IN THE WALK AND NOT A STATE A READER IS SHOWN. A pane
 * drawn from it says the lead has recorded nothing and is holding nothing —
 * the two claims these panels reserve for a lead that really has — and when the
 * reset lands on the last read of the budget it says them until the store is
 * written again.
 */
test("a cut that moves on the last read does not blank the log", async () => {
  const store = compactingStore(leadTranscriptReadsMax);
  await mountLead();
  expect(store.reads()).toBe(leadTranscriptReadsMax);
  expect(
    screen.queryByText("No conversation"),
    "the walk's own reset was drawn as a lead that has recorded nothing",
  ).toBeNull();
  expect(exchangeCount()).toBeGreaterThan(0);
  expect(
    screen.getByText("Not reached"),
    "what the lead holds was still claimed after the cut moved under the walk",
  ).toBeDefined();
});

/** A re-walk that finishes inside the budget draws what it rebuilt rather than
 * the stale kept fold — and still says the store has not been read to its end,
 * since this store's cursor always advances and the budget never catches it. */
test("a cut that moves early is rebuilt inside the budget and drawn", async () => {
  compactingStore(2);
  await mountLead();
  expect(exchangeCount()).toBeGreaterThan(0);
  expect(screen.queryByText("No conversation")).toBeNull();
  expect(screen.getByText("Not reached")).toBeDefined();
});

/** A store whose pages the case decides, so a probe can move the cut, fail a
 * read, or answer entry-less pages at whatever point it is about. */
function scriptedStore(answering: (read: number, after: number) => Response): {
  readonly reads: () => number;
} {
  let reads = 0;
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript")) {
        const after = Number(
          new URL(url, "https://console").searchParams.get("after") ?? "0",
        );
        reads += 1;
        return answering(reads, after);
      }
      const found = leadRouteAnswer(url, { ...opening, batches: 40 });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  return { reads: () => reads };
}

function scriptedPage(
  after: number,
  cut: number,
  entries: readonly string[],
): Response {
  return answer({
    stream: leadStream,
    entries: entries.map((uuid) => ({
      uuid,
      type: "assistant",
      message: { content: [] },
    })),
    held: [...entries],
    cut,
    elided: 0,
    truncated: false,
    nextAfter: after + 1,
  });
}

/**
 * The reason a read gave has to reach the reader even when a re-walk is in
 * flight, because the pane is then drawing a fold from before the compaction
 * and a reader with no notice has no way to know why it stopped moving.
 */
test("a read that fails after a cut moved still draws its reason", async () => {
  scriptedStore((read, after) => {
    if (read === 1) return scriptedPage(after, 1, [`uuid-${String(after)}`]);
    if (read === 2) return scriptedPage(after, 9, [`uuid-${String(after)}`]);
    return answer({ error: { code: "InternalError", message: "no" } }, 500);
  });
  await mountLead();
  expect(
    screen.getByText(/^Failed · /u),
    "a read that failed across a re-walk said nothing to the reader",
  ).toBeDefined();
  expect(screen.queryByText("No conversation")).toBeNull();
});

/**
 * A re-walk whose own pages draw nothing — every batch elided, or every entry
 * meta — must not replace a whole chain with the two claims these panels
 * reserve for a lead that has recorded nothing.
 */
test("a re-walk that draws nothing keeps the chain the reader had", async () => {
  scriptedStore((read, after) => {
    if (read === 1) return scriptedPage(after, 1, [`uuid-${String(after)}`]);
    if (read === 2) return scriptedPage(after, 9, [`uuid-${String(after)}`]);
    return answer({
      stream: leadStream,
      entries: [],
      held: [],
      cut: 9,
      elided: 1,
      truncated: false,
      nextAfter: after + 1,
    });
  });
  await mountLead();
  expect(
    screen.queryByText("No conversation"),
    "a re-walk drawing nothing said the lead had recorded nothing",
  ).toBeNull();
  expect(exchangeCount()).toBeGreaterThan(0);
  expect(screen.getByText("Not reached")).toBeDefined();
});

/** The word a pane says when it really does hold nothing, drawn rather than
 * merely absent. */
test("a lead that has recorded nothing says so", async () => {
  scriptedStore((_read, after) =>
    answer({
      stream: leadStream,
      entries: [],
      held: [],
      cut: 1,
      elided: 0,
      truncated: false,
      nextAfter: after + 1,
    }),
  );
  await mountLead();
  expect(screen.getByText("No conversation")).toBeDefined();
});

/** What the read could not draw is drawn as itself, in the words the counts
 * behind them are pinned under. */
test("what a read could not draw is said beside what it did", async () => {
  scriptedStore((read, after) =>
    read === 1
      ? answer({
          stream: leadStream,
          entries: [
            { uuid: "uuid-a", type: "assistant", message: { content: [] } },
          ],
          held: ["uuid-a"],
          cut: 1,
          elided: 2,
          truncated: true,
          nextAfter: after + 1,
        })
      : answer({
          stream: leadStream,
          entries: [],
          held: [],
          cut: 1,
          elided: 0,
          truncated: false,
        }),
  );
  await mountLead();
  expect(screen.getByText("Elided · 2 batches")).toBeDefined();
  expect(screen.getAllByText("Truncated").length).toBeGreaterThan(0);
});

/** What a pane stopped holding is said as itself: a chain longer than the cap
 * is drawn short, and a reader with no notice reads the short one as the whole
 * of it. */
test("the entries a pane stopped holding are counted where a reader sees them", async () => {
  const overflowing = leadTranscriptEntriesHeldMax + 2;
  scriptedStore((read, after) =>
    read === 1
      ? answer({
          stream: leadStream,
          entries: Array.from({ length: overflowing }, (_unused, at) => ({
            uuid: `uuid-${String(at).padStart(4, "0")}`,
            type: "assistant",
            message: { content: [] },
          })),
          held: [],
          cut: 1,
          elided: 0,
          truncated: false,
          nextAfter: after + 1,
        })
      : answer({
          stream: leadStream,
          entries: [],
          held: [],
          cut: 1,
          elided: 0,
          truncated: false,
        }),
  );
  await mountLead();
  expect(screen.getByText("Dropped · 2")).toBeDefined();
});

/**
 * A DIFFERENT STREAM IS A DIFFERENT PANE. The lead's own reference changes when
 * its session is resumed on a new store, and a walk that merged the new
 * stream's pages into the old stream's fold would draw one lead's chain as the
 * other's.
 */
test("a lead that changes stream is walked as a new pane", async () => {
  let stream = leadStream;
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/lead/transcript"))
        return answer({
          stream,
          entries: [
            {
              uuid: `${stream}-entry`,
              type: "assistant",
              message: { content: [{ type: "text", text: `on ${stream}` }] },
            },
          ],
          held: [`${stream}-entry`],
          cut: 1,
          elided: 0,
          truncated: false,
        });
      if (url.includes("/lead") && !url.includes("/transcript"))
        return answer({
          ...leadBody(1, 1),
          agentReference: stream,
          streams: [{ stream, batches: 1 }],
        });
      const found = leadRouteAnswer(url, opening);
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = await mountLead();
  expect(screen.getByText(`on ${leadStream}`)).toBeDefined();
  stream = "another-stream";
  await turned(() => {
    server.push(
      frame("Session", "60", {
        version: 1,
        resource: leadSessionResource(leadSession, "turn-2"),
        representation: null,
      }),
    );
  });
  await settled();
  expect(screen.getByText("on another-stream")).toBeDefined();
  expect(
    screen.queryByText(`on ${leadStream}`),
    "one lead's chain was drawn as another stream's",
  ).toBeNull();
  expect(exchangeCount()).toBe(1);
});

/** A walk waiting at a stall has not reached the rest of the stream, so the
 * entry it did draw stands beside the marker for the range it did not. */
test("an unreached tail draws its marker", async () => {
  scriptedStore((_read, after) =>
    answer({
      stream: leadStream,
      entries: [
        {
          uuid: `uuid-${String(after)}`,
          type: "assistant",
          message: {
            content: [{ type: "text", text: `batch ${String(after)}` }],
          },
        },
      ],
      held: [],
      cut: 1,
      elided: 0,
      truncated: false,
      nextAfter: after,
    }),
  );
  await mountLead();
  expect(screen.getByText("batch 0")).toBeDefined();
  expect(screen.getAllByText("Not reached").length).toBe(1);
  expect(screen.queryByText("No conversation")).toBeNull();
});

/**
 * A door whose first answer is lost and whose next one lands, recording where
 * each pair was posted, which is what a case about pairs across a project
 * switch reads.
 */
function askingLead(): {
  readonly fetch: typeof fetch;
  readonly posted: { readonly url: string; readonly session: string }[];
} {
  const posted: { readonly url: string; readonly session: string }[] = [];
  let asks = 0;
  const fetching = ((
    url: string,
    init?: { method?: string; body?: string },
  ) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "null") as { session: string };
      posted.push({ url, session: body.session });
      asks += 1;
      return Promise.resolve(
        asks === 1
          ? answer({ error: { code: "InternalError", message: "no" } }, 500)
          : answer(
              { session: body.session, turn: "inq-turn-1", ordinal: 1 },
              202,
            ),
      );
    }
    const found = leadRouteAnswer(url, opening);
    return Promise.resolve(answer(found.body, found.status));
  }) as unknown as typeof fetch;
  return { fetch: fetching, posted };
}

/** The page, and the navigation that moves only the route's params — which is
 * what reuses this instance rather than replacing it. */
interface LeadNavigation {
  readonly moveTo: (partition: PartitionIdentity) => Promise<void>;
  readonly away: () => Promise<void>;
}

async function drawLeadPage(fetching: typeof fetch): Promise<LeadNavigation> {
  vi.stubGlobal("fetch", fetching);
  const server = openedStream();
  const client = new QueryClient();
  const under = (partition: PartitionIdentity) => (
    <ScreenHarness
      partition={partition}
      client={client}
      transport={server.ports.fetch}
    >
      <ShellSlotHarness>
        <LeadPage />
      </ShellSlotHarness>
    </ScreenHarness>
  );
  const page = render(under(drawnPartition));
  await settled();
  return {
    moveTo: async (partition: PartitionIdentity) => {
      drawnPartition = { ...partition };
      await turned(() => {
        page.rerender(under(partition));
      });
      await settled();
    },
    /** A sibling screen and back, which is a route change rather than a params
     * one: the lead page is replaced outright and mounted again. */
    away: async () => {
      await turned(() => {
        page.rerender(
          <ScreenHarness
            partition={drawnPartition}
            client={client}
            transport={server.ports.fetch}
          >
            <p>elsewhere</p>
          </ScreenHarness>,
        );
      });
      await settled();
      await turned(() => {
        page.rerender(under(drawnPartition));
      });
      await settled();
    },
  };
}

function askQuestion(said: string): void {
  fireEvent.change(screen.getByLabelText("Question"), {
    target: { value: said },
  });
}

/**
 * THE HEAD THAT GATES THE ASK BOX IS ABSENT EXACTLY WHEN A READER MOVES. A
 * project switch re-keys the lead read, which has no placeholder, so the page
 * draws at least one render with no head at all — and a box held inside the
 * control that head gates would be discarded by the navigation the box exists to
 * survive, leaving the reader's question gone and their next press asking one
 * door one question under a second pair.
 */
test("a project switch and a return leave the box and its pair where they were", async () => {
  const asked = askingLead();
  const { moveTo } = await drawLeadPage(asked.fetch);
  const box = () => screen.getByLabelText<HTMLTextAreaElement>("Question");
  askQuestion("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  expect(screen.getByText(/^Failed · /u)).toBeDefined();
  await moveTo({ tenant: "acme", project: "beta" });
  expect(
    box().value,
    "one project's question was drawn on another project's page",
  ).toBe("");
  await moveTo(leadPartition);
  expect(
    box().value,
    "a reader came back to a project and found their question gone",
  ).toBe("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  expect(
    asked.posted.map((post) => post.url.includes("/projects/atlas/")),
  ).toStrictEqual([true, true]);
  expect(
    asked.posted[1]?.session,
    "the page forked one door twice for one question",
  ).toBe(asked.posted[0]?.session);
});

/**
 * THE PAIR IS A DE-DUPLICATION TOKEN AND EVERY SCREEN IS A SIBLING OF THIS ONE.
 * A lead page replaced by a click on the inbox and mounted again is not the
 * params navigation the box was made to survive; a token held in the page would
 * go with it, and the next press would open a second fork for one question and
 * spend the second of the asker's two.
 */
test("a click away to another screen and back keeps the box and its pair", async () => {
  const asked = askingLead();
  const { away } = await drawLeadPage(asked.fetch);
  const box = () => screen.getByLabelText<HTMLTextAreaElement>("Question");
  askQuestion("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  expect(screen.getByText(/^Failed · /u)).toBeDefined();
  await away();
  expect(
    box().value,
    "a reader came back to the lead page and found their question gone",
  ).toBe("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  expect(asked.posted.length).toBe(2);
  expect(
    asked.posted[1]?.session,
    "a click on another screen forked one door twice for one question",
  ).toBe(asked.posted[0]?.session);
});

/**
 * A PROJECT WITH NO LEAD IS A PAGE SAYING SO, and the page says it by drawing
 * nothing else at all — so a reader who visits one between two presses would
 * lose the pair to a gate that draws no box rather than to one that hides it.
 */
test("a visit to a project with no lead keeps the box of the one that has it", async () => {
  const asked = askingLead();
  const absent = { tenant: "acme", project: "leadless" };
  const fetching = ((url: string, init?: { method?: string; body?: string }) =>
    url.includes("/projects/leadless/") && init?.method !== "POST"
      ? Promise.resolve(answer({ error: { code: "NotFound" } }, 404))
      : (asked.fetch as (url: string, init?: unknown) => Promise<Response>)(
          url,
          init,
        )) as unknown as typeof fetch;
  const { moveTo } = await drawLeadPage(fetching);
  const box = () => screen.getByLabelText<HTMLTextAreaElement>("Question");
  askQuestion("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  await moveTo(absent);
  expect(screen.getByRole("heading", { name: "No lead" })).toBeDefined();
  await moveTo(leadPartition);
  expect(
    box().value,
    "a project that answers no lead took another project's question with it",
  ).toBe("why is ticket 41 waiting?");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  await settled();
  styleless();
  expect(
    asked.posted[1]?.session,
    "a visit to a leadless project forked another door twice",
  ).toBe(asked.posted[0]?.session);
});
