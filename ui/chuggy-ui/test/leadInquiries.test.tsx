/**
 * The inquiries panel and the box that fills it.
 *
 * THE LIVE CASE IS THE ONE WITH TEETH, AND IT IS ABOUT WHICH FRAMES REACH
 * WHICH PANEL. Every session of a project raises `Session` frames — the lead,
 * each thread, each inquiry — and the two panels on this page must divide them:
 * the lead's panel on the session it names, this one on the kind. A panel that
 * took the other's frames would either never update or re-read five panels on
 * every question, and neither looks wrong on the page.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadInquiries } from "../app/browser/lead/LeadInquiries.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import {
  leadInquiry,
  leadPartition,
  leadSession,
  leadStream,
} from "./leadFixture.ts";
import {
  inquiriesAnsweredMax,
  inquiryQuestionCharsMax,
} from "../../../src/contract/http.ts";
import { sessionTurnStates } from "../../../src/contract/rosters.ts";
import type { LeadInquiriesResponse } from "../../../src/contract/responses.ts";
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

interface InquiryServer {
  readonly stream: ReturnType<typeof openedStream>;
  readonly reads: () => number;
  readonly posts: () => readonly unknown[];
}

interface InquiryInit {
  readonly method?: string;
  readonly body?: string;
}

/**
 * The panel over a server whose listing the case may move under it and whose
 * answer to the post the case decides. `head` is the lead's runtime reference,
 * which is the only thing the page knows that decides whether a box is drawn.
 */
async function drawInquiries(served: {
  readonly listing: () => LeadInquiriesResponse;
  readonly asked?: () => { readonly body: unknown; readonly status: number };
  readonly head?: string | undefined;
}): Promise<InquiryServer> {
  let reads = 0;
  const posts: unknown[] = [];
  const fetching = ((_url: string, init?: InquiryInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "null"));
      const found = served.asked?.() ?? {
        body: { session: "inq-new", turn: "inq-turn-new", ordinal: 1 },
        status: 202,
      };
      return Promise.resolve(answer(found.body, found.status));
    }
    reads += 1;
    return Promise.resolve(answer(served.listing()));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  const stream = openedStream();
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={stream.ports.fetch}
    >
      <LeadInquiries
        partition={leadPartition}
        head={"head" in served ? served.head : leadStream}
        nowMs={Date.parse("2026-09-01T12:00:00Z")}
      />
    </ScreenHarness>,
  );
  await settled();
  return { stream, reads: () => reads, posts: () => posts };
}

function rows(): readonly string[] {
  return [...document.querySelectorAll(".lead-inquiry-question")].map(
    (row) => row.textContent ?? "",
  );
}

/** One frame of the kind, named as the trigger names it: the session, what kind
 * of session it is, and the turn that moved. */
async function pushed(
  server: InquiryServer,
  id: string,
  resource: unknown,
): Promise<void> {
  await turned(() => {
    server.stream.push(
      frame("Session", id, { version: 1, resource, representation: null }),
    );
  });
  await settled();
}

function sessionResource(session: string, kind: string): string {
  return JSON.stringify({ session, kind, turn: `turn-${session}` });
}

const answered = leadInquiry(1, {
  turnState: "Answered",
  mine: true,
  answer: "ticket 41 is waiting on its dependency",
});

test("a row names the asker, its state, the question and the answer in place", async () => {
  await drawInquiries({ listing: () => ({ inquiries: [answered] }) });
  expect(screen.getByText("subject-1")).toBeDefined();
  expect(screen.getByText("Mine")).toBeDefined();
  expect(screen.getByText("Answered")).toBeDefined();
  expect(screen.getByText("question 1")).toBeDefined();
  expect(
    screen.getByText("ticket 41 is waiting on its dependency"),
  ).toBeDefined();
});

test("a lead nobody has asked anything says so", async () => {
  await drawInquiries({ listing: () => ({ inquiries: [] }) });
  expect(screen.getByText("No inquiries")).toBeDefined();
});

/** Every state a turn can be in is drawn as its own word; a roster the wire
 * grows and this panel does not draw would reach a reader as a blank cell. */
test("each turn state in the roster is drawn as its own word", async () => {
  await drawInquiries({
    listing: () => ({
      inquiries: sessionTurnStates.map((state, at) =>
        leadInquiry(at + 1, { turnState: state }),
      ),
    }),
  });
  for (const state of sessionTurnStates)
    expect(screen.getByText(state), state).toBeDefined();
});

/**
 * THE PANEL FOLLOWS THE KIND AND NOT THE SESSION. An inquiry's turn moving is a
 * frame naming that fork, which the lead's own predicate ignores; a panel that
 * shared it would sit on the questions it opened with while every answer
 * arrived.
 */
test("an Inquiry frame re-reads the panel and a Lead frame does not", async () => {
  let listing: LeadInquiriesResponse = {
    inquiries: [leadInquiry(1, { turnState: "Queued" })],
  };
  const server = await drawInquiries({ listing: () => listing });
  expect(rows()).toStrictEqual(["question 1"]);
  listing = { inquiries: [leadInquiry(2, { turnState: "Queued" })] };
  await pushed(server, "70", sessionResource(leadSession, "Lead"));
  expect(
    rows(),
    "a frame naming the lead's own session re-read the inquiries",
  ).toStrictEqual(["question 1"]);
  await pushed(server, "71", sessionResource("thread-1", "Thread"));
  expect(rows(), "a thread's frame re-read the inquiries").toStrictEqual([
    "question 1",
  ]);
  await pushed(server, "72", sessionResource("inq-9", "Inquiry"));
  expect(
    rows(),
    "an inquiry's own frame did not reach the panel watching them",
  ).toStrictEqual(["question 2"]);
});

/** A resource this console cannot read is a frame it ignores rather than one it
 * throws on, and a bare string is the shape a reviewer will send. */
test("a Session frame with a resource this console cannot read is ignored", async () => {
  let listing: LeadInquiriesResponse = {
    inquiries: [leadInquiry(1, { turnState: "Queued" })],
  };
  const server = await drawInquiries({ listing: () => listing });
  listing = { inquiries: [leadInquiry(2, { turnState: "Queued" })] };
  await pushed(server, "73", "inq-9");
  await pushed(server, "74", "{");
  await pushed(server, "75", JSON.stringify({ ticket: 42 }));
  expect(rows()).toStrictEqual(["question 1"]);
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();
});

/**
 * The order is the route's own. It answers newest first over a bounded page, so
 * a panel that sorted would rearrange a page it did not choose the members of —
 * and the only number a row carries counts turns of one session, so every
 * inquiry has the same one.
 */
test("rows are drawn in the order the route gave and are not re-sorted", async () => {
  await drawInquiries({
    listing: () => ({
      inquiries: [
        leadInquiry(3, { turnState: "Queued" }),
        leadInquiry(1, { turnState: "Answered", answer: "one" }),
        leadInquiry(2, { turnState: "Claimed" }),
      ],
    }),
  });
  expect(rows()).toStrictEqual(["question 3", "question 1", "question 2"]);
});

/**
 * THE ANSWER IS MODEL PROSE FROM A FORK AND THE CONSOLE DOES NOT INTERPRET IT.
 * Drawn as markup it would be a page whose content the lead's own answer can
 * change.
 */
test("an answer carrying markup is drawn as text", async () => {
  const markup = "<img src=x onerror=alert(1)> **not bold**";
  await drawInquiries({
    listing: () => ({
      inquiries: [leadInquiry(1, { turnState: "Answered", answer: markup })],
    }),
  });
  expect(screen.getByText(markup)).toBeDefined();
  expect(
    document.querySelector(".lead-inquiry img"),
    "an answer's markup was drawn as markup",
  ).toBeNull();
});

/**
 * The listing is bounded by the schema that reads it, so a route answering more
 * than the bound is a body this console will not draw at all rather than a
 * panel that quietly grew.
 */
test("a listing past the bound is refused rather than drawn", async () => {
  const asking = (count: number): LeadInquiriesResponse => ({
    inquiries: Array.from({ length: count }, (_unused, at) =>
      leadInquiry(at + 1, { turnState: "Queued" }),
    ),
  });
  await drawInquiries({ listing: () => asking(inquiriesAnsweredMax) });
  expect(rows().length).toBe(inquiriesAnsweredMax);
  cleanup();
  await drawInquiries({ listing: () => asking(inquiriesAnsweredMax + 1) });
  expect(
    rows().length,
    "a listing past the route's own bound was drawn anyway",
  ).toBe(0);
  expect(screen.getByText(/^Failed to load · /u)).toBeDefined();
});

/** A lead that has never settled a turn has no head to fork from, so there is
 * nothing to ask and the door would refuse. */
test("the box is drawn only where the lead has a head to fork", async () => {
  await drawInquiries({ listing: () => ({ inquiries: [] }), head: undefined });
  expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  expect(screen.queryByLabelText("Question")).toBeNull();
  cleanup();
  await drawInquiries({ listing: () => ({ inquiries: [] }) });
  expect(screen.getByRole("button", { name: "Ask" })).toBeDefined();
});

function typed(question: string): void {
  fireEvent.change(screen.getByLabelText("Question"), {
    target: { value: question },
  });
}

function ask(): void {
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

/** The bound is refused before the wire is touched, so a reader is told what is
 * wrong rather than shown the route's own rejection a round trip later. */
test("a question past the bound is refused before it is posted", async () => {
  const server = await drawInquiries({ listing: () => ({ inquiries: [] }) });
  await turned(() => {
    typed("q".repeat(inquiryQuestionCharsMax));
  });
  expect(screen.queryByText("Too long")).toBeNull();
  await turned(() => {
    typed("q".repeat(inquiryQuestionCharsMax + 1));
  });
  expect(screen.getByText("Too long")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled"),
  ).toBe(true);
  await turned(ask);
  await settled();
  expect(
    server.posts().length,
    "a question over the bound was posted anyway",
  ).toBe(0);
});

test("an empty box posts nothing", async () => {
  const server = await drawInquiries({ listing: () => ({ inquiries: [] }) });
  await turned(() => {
    typed("   ");
  });
  await turned(ask);
  await settled();
  expect(server.posts().length).toBe(0);
});

/** The post carries the pair the door is idempotent on, and the question with
 * the ends nobody meant to type taken off. */
test("a question is posted under one minted fork and turn", async () => {
  let listing: LeadInquiriesResponse = { inquiries: [] };
  const server = await drawInquiries({ listing: () => listing });
  listing = { inquiries: [leadInquiry(1, { turnState: "Queued" })] };
  await turned(() => {
    typed("  what is blocking ticket 41?  ");
  });
  await turned(ask);
  await settled();
  const posted = server.posts()[0] as {
    readonly session: string;
    readonly turn: string;
    readonly question: string;
  };
  expect(posted.question).toBe("what is blocking ticket 41?");
  expect(posted.session.startsWith("inq-")).toBe(true);
  expect(posted.turn.startsWith("inq-turn-")).toBe(true);
  expect(
    rows(),
    "the panel was not re-read after the post landed",
  ).toStrictEqual(["question 1"]);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Question").value).toBe("");
});

/**
 * ONE PRESS IS ONE QUESTION. Two presses inside one render both read the render
 * they were drawn from, so the control being disabled by the next one stops
 * neither — and each press mints a pair of its own, so the door sees two
 * questions rather than a retry of one and the asker's quota pays for both.
 */
test("two presses inside one turn ask once", async () => {
  const server = await drawInquiries({ listing: () => ({ inquiries: [] }) });
  await turned(() => {
    typed("what is blocking ticket 41?");
  });
  await turned(() => {
    ask();
    ask();
  });
  await settled();
  expect(server.posts().length, "one press asked twice").toBe(1);
});

/**
 * A refusal is the lead's own answer and is drawn as a word beside the box the
 * question is still in. A box that blanked would take the question away with
 * the refusal.
 */
test("a door that refuses is drawn as a word, not as a blank panel", async () => {
  const refusals = [
    {
      status: 429,
      body: { error: { code: "InquiriesInFlight", message: "two open" } },
      word: "In flight",
    },
    {
      status: 409,
      body: { error: { code: "LeadNotStarted", message: "no head" } },
      word: "Not started",
    },
  ];
  for (const refusal of refusals) {
    const server = await drawInquiries({
      listing: () => ({ inquiries: [leadInquiry(1, { turnState: "Queued" })] }),
      asked: () => ({ body: refusal.body, status: refusal.status }),
    });
    await turned(() => {
      typed("why is ticket 41 waiting?");
    });
    await turned(ask);
    await settled();
    expect(screen.getByText(refusal.word), refusal.word).toBeDefined();
    expect(rows(), refusal.word).toStrictEqual(["question 1"]);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Question").value,
      "a refused question was taken away from the reader who typed it",
    ).toBe("why is ticket 41 waiting?");
    expect(server.posts().length).toBeGreaterThan(0);
    cleanup();
  }
});
