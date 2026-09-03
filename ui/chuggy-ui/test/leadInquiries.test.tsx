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

import {
  LeadInquiries,
  leadInquiriesListName,
  useInquiryBoxes,
} from "../app/browser/lead/LeadInquiries.tsx";
import { projectListRereadNamed } from "../app/core/projectQueryKeys.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import { inquiryBoxesHeld } from "../app/browser/lead/inquiryBoxes.ts";
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
import { apiAttemptsMax } from "../app/core/apiRequest.ts";
import { sessionTurnStates } from "../../../src/contract/rosters.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
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
  inquiryBoxesHeld.discard();
  vi.unstubAllGlobals();
});

/**
 * The panel under a caller that holds the boxes, which is what `LeadPage` is:
 * the head is gated below this, so a switch that passes through an absent head
 * is the page's own navigation and not a shape only a case can make.
 */
function InquiryHolder(props: {
  readonly partition: PartitionIdentity;
  readonly head: string | undefined;
}): ReactNode {
  const held = useInquiryBoxes();
  return (
    <LeadInquiries
      partition={props.partition}
      head={props.head}
      held={held}
      nowMs={Date.parse("2026-09-01T12:00:00Z")}
    />
  );
}

interface InquiryServer {
  readonly stream: ReturnType<typeof openedStream>;
  readonly reads: () => number;
  readonly posts: () => readonly unknown[];
  readonly postUrls: () => readonly string[];
  readonly readUrls: () => readonly string[];
  readonly client: QueryClient;
  /**
   * The same instance under another project's params, which is what a
   * params-only navigation does: the route declares no `remountDeps`, so the
   * box is reconciled rather than remounted and keeps everything it holds.
   */
  readonly moveTo: (partition: PartitionIdentity) => Promise<void>;
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
  readonly asked?: (
    body: unknown,
    url: string,
  ) => { readonly body: unknown; readonly status: number };
  readonly head?: string | undefined;
  /** Held open so a case can read the box while a press is still in flight. */
  readonly gate?: () => Promise<void>;
}): Promise<InquiryServer> {
  let reads = 0;
  const posts: unknown[] = [];
  const postUrls: string[] = [];
  const readUrls: string[] = [];
  const fetching = ((url: string, init?: InquiryInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "null") as unknown;
      posts.push(body);
      postUrls.push(url);
      const found = served.asked?.(body, url) ?? {
        body: { session: "inq-new", turn: "inq-turn-new", ordinal: 1 },
        status: 202,
      };
      const waited = served.gate?.() ?? Promise.resolve();
      return waited.then(() => answer(found.body, found.status));
    }
    reads += 1;
    readUrls.push(url);
    return Promise.resolve(answer(served.listing()));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  const stream = openedStream();
  const client = new QueryClient();
  const head = "head" in served ? served.head : leadStream;
  const panel = (partition: PartitionIdentity, at: string | undefined) => (
    <ScreenHarness
      partition={partition}
      client={client}
      transport={stream.ports.fetch}
    >
      <InquiryHolder partition={partition} head={at} />
    </ScreenHarness>
  );
  const drawn = render(panel(leadPartition, head));
  await settled();
  return {
    stream,
    reads: () => reads,
    posts: () => posts,
    postUrls: () => postUrls,
    readUrls: () => readUrls,
    client,
    moveTo: async (partition: PartitionIdentity) => {
      await turned(() => {
        drawn.rerender(panel(partition, undefined));
      });
      await settled();
      await turned(() => {
        drawn.rerender(panel(partition, head));
      });
      await settled();
    },
  };
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

/**
 * THE ONLY WAY THE BOX AND THE WIRE CAN MEASURE ONE QUESTION DIFFERENTLY IS
 * OUTSIDE THE BASIC PLANE. Counted in characters instead of the units zod
 * counts, a question of astral characters twice the bound's length draws no
 * fault and goes out to be rejected as `400` — drawn as the unrecognised-code
 * word, telling the reader nothing about what was wrong.
 */
test("a question of astral characters is refused at the wire's own bound", async () => {
  const astral = "\u{1f600}";
  const server = await drawInquiries({ listing: () => ({ inquiries: [] }) });
  await turned(() => {
    typed(astral.repeat(inquiryQuestionCharsMax / 2));
  });
  expect(screen.queryByText("Too long")).toBeNull();
  await turned(() => {
    typed(astral.repeat(inquiryQuestionCharsMax / 2 + 1));
  });
  expect(
    screen.getByText("Too long"),
    "a question the wire will reject was drawn as one the box would send",
  ).toBeDefined();
  await turned(ask);
  await settled();
  expect(server.posts().length).toBe(0);
});

/** What the turn spent on the project's shared account, where the reader who
 * asked can see it. */
test("a measured inquiry draws what it cost", async () => {
  await drawInquiries({
    listing: () => ({
      inquiries: [
        leadInquiry(1, {
          turnState: "Answered",
          answer: "a",
          tokens: 12_400,
          costMicros: 41_000,
          durationMs: 21_000,
        }),
      ],
    }),
  });
  expect(screen.getByText("$0.04")).toBeDefined();
  expect(screen.getByText("12k")).toBeDefined();
});

/**
 * EACH MEASURE IS OPTIONAL ON ITS OWN, a failed inquiry being the obvious turn
 * that was timed and billed nothing. A guard naming only the other two drops the
 * one measure such a turn has.
 */
test("an inquiry that was timed and billed nothing draws its duration", async () => {
  await drawInquiries({
    listing: () => ({
      inquiries: [
        leadInquiry(1, {
          turnState: "Failed",
          failure: "AgentFailed",
          durationMs: 21_000,
        }),
      ],
    }),
  });
  expect(screen.getByText("21s")).toBeDefined();
});

/** A control nobody has touched is not one a reader got wrong, and marking it
 * invalid on mount is the box saying so before they have typed. */
test("an untouched box is not marked as a reader's mistake", async () => {
  await drawInquiries({ listing: () => ({ inquiries: [] }) });
  const box = screen.getByLabelText("Question");
  expect(screen.queryByText("Empty")).toBeNull();
  expect(box.getAttribute("aria-invalid")).toBe("false");
  expect(
    screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled"),
    "an untouched box offered a press that could only be refused",
  ).toBe(true);
  await turned(() => {
    typed("   ");
  });
  expect(screen.getByText("Empty")).toBeDefined();
  expect(box.getAttribute("aria-invalid")).toBe("true");
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
 * A door whose first answer does not reach the box and whose next one lands,
 * which is the send a held pair exists for.
 */
function answerLostThenTaken(): () => {
  readonly body: unknown;
  readonly status: number;
} {
  let asks = 0;
  return () => {
    asks += 1;
    return asks === 1
      ? {
          body: { error: { code: "InternalError", message: "no" } },
          status: 500,
        }
      : {
          body: { session: "inq-new", turn: "inq-turn-new", ordinal: 1 },
          status: 202,
        };
  };
}

function refusal(code: string, status = 409) {
  return { body: { error: { code, message: code } }, status };
}

/**
 * A refusal is the lead's own answer and is drawn as a word beside the box the
 * question is still in. A box that blanked would take the question away with
 * the refusal.
 */
test("a door that refuses is drawn as a word, not as a blank panel", async () => {
  const refusals = [
    { code: "InquiriesInFlight", word: "In flight" },
    { code: "LeadNotStarted", word: "Not started" },
    { code: "LeadClosed", word: "Closed" },
  ];
  for (const refused of refusals) {
    const server = await drawInquiries({
      listing: () => ({ inquiries: [leadInquiry(1, { turnState: "Queued" })] }),
      asked: () => refusal(refused.code),
    });
    await turned(() => {
      typed("why is ticket 41 waiting?");
    });
    await turned(ask);
    await settled();
    expect(screen.getByText(refused.word), refused.word).toBeDefined();
    expect(rows(), refused.word).toStrictEqual(["question 1"]);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Question").value,
      "a refused question was taken away from the reader who typed it",
    ).toBe("why is ticket 41 waiting?");
    expect(
      server.posts().length,
      "a refusal the door states once cost more than one post",
    ).toBe(1);
    cleanup();
  }
});

/**
 * THE OPEN BOUND IS A REFUSAL AND NOT A DELAY, which is why the door answers it
 * `409`: a `429` is a status this console's transport retries, so the same
 * refusal would cost `apiAttemptsMax` posts and leave the box on `Asking` for
 * two of the server's own waits before the word appeared.
 */
test("the open bound answered as retryable costs the transport's whole budget", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => refusal("InquiriesInFlight", 429),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(screen.getByText("In flight")).toBeDefined();
  expect(server.posts().length).toBe(apiAttemptsMax);
});

/**
 * A REFUSAL MUST NOT LATCH THE BOX SHUT. The whole reason a refused question
 * stays in the textarea is so the reader can ask again once an inquiry settles,
 * and a one-press flag that is only released on success makes trying again do
 * nothing at all, with the control enabled and no notice changing.
 */
test("a box that was refused can ask again", async () => {
  let asks = 0;
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => {
      asks += 1;
      return asks === 1
        ? refusal("InquiriesInFlight")
        : {
            body: { session: "inq-new", turn: "inq-turn-new", ordinal: 1 },
            status: 202,
          };
    },
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(screen.getByText("In flight")).toBeDefined();
  await turned(ask);
  await settled();
  expect(
    server.posts().length,
    "a second press after a refusal posted nothing",
  ).toBe(2);
  expect(screen.getByText("Asked")).toBeDefined();
});

/**
 * THE PAIR IN THE BODY IS THE ONLY THING THAT MAKES A RE-SEND A RETRY, this
 * being the route with no idempotency key. A send that did not land leaves the
 * asker unable to know whether the lead was forked, so a fresh pair on the next
 * press opens a second fork and spends the second of their two.
 */
test("a re-send after a send that did not land carries the same pair", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: answerLostThenTaken(),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(screen.getByText(/^Failed · /u)).toBeDefined();
  await turned(ask);
  await settled();
  const sent = sessionsPosted(server);
  expect(sent.length).toBe(2);
  expect(
    sent[1],
    "a re-sent question was asked under a second pair, so the door forked twice",
  ).toBe(sent[0]);
});

/**
 * A PRESS IN FLIGHT IS SAID AS BUSY AND NOT ONLY AS DISABLED, `disabled` alone
 * telling a reader on assistive technology that the control is unavailable
 * rather than that their question is on its way.
 */
test("a press in flight reports itself busy", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await drawInquiries({
    listing: () => ({ inquiries: [] }),
    gate: () => gate,
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  expect(
    screen.getByRole("button", { name: "Ask" }).getAttribute("aria-busy"),
    "a press in flight said nothing about being in flight",
  ).toBe("true");
  expect(screen.getByText("Asking")).toBeDefined();
  await turned(release);
  await settled();
  expect(
    screen.getByRole("button", { name: "Ask" }).getAttribute("aria-busy"),
  ).not.toBe("true");
});

const elsewhere = { tenant: "acme", project: "beta" };

/**
 * A DOOR THAT HAS ALREADY SEEN A SESSION NAME REFUSES IT, which is what 058's
 * installation-wide uniqueness on `session` makes true of every project's door
 * at once. Answered here so a case can tell a pair carried across a project
 * from one drawn for the project it is sent to.
 */
function uniqueDoor(): (
  body: unknown,
  url: string,
) => { readonly body: unknown; readonly status: number } {
  const seen = new Map<string, string>();
  let answers = 0;
  return (body, url) => {
    const sent = body as { readonly session: string };
    const held = seen.get(sent.session);
    if (held !== undefined && held !== url)
      return {
        body: { error: { code: "InternalError", message: "session in use" } },
        status: 500,
      };
    seen.set(sent.session, url);
    answers += 1;
    return answers === 1
      ? {
          body: { error: { code: "InternalError", message: "answer lost" } },
          status: 500,
        }
      : {
          body: { session: sent.session, turn: "inq-turn-new", ordinal: 1 },
          status: 202,
        };
  };
}

/**
 * A PROJECT SWITCH IS NOT A REMOUNT: the route declares no `remountDeps` and
 * the router sets no default, so this box outlives the project it drew its pair
 * for. Carrying that pair to the next project's door asks it for a fork it does
 * not hold, or asks the installation for a session name it has already used.
 */
function sessionsPosted(server: InquiryServer): readonly string[] {
  return server.posts().map((post) => (post as { session: string }).session);
}

test("a pair drawn for one project is not posted to another after a switch", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: answerLostThenTaken(),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(screen.getByText(/^Failed · /u)).toBeDefined();
  await server.moveTo(elsewhere);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Question").value,
    "one project's question was drawn in another project's box",
  ).toBe("");
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  const urls = server.postUrls();
  expect(urls[0]).toContain("/projects/atlas/lead/inquiries");
  expect(urls[1]).toContain("/projects/beta/lead/inquiries");
  const sent = sessionsPosted(server);
  expect(
    sent[1],
    "a pair drawn for one project was posted to another project's door",
  ).not.toBe(sent[0]);
});

/**
 * THE PANEL IS THE SAME INSTANCE ACROSS A PROJECT SWITCH, which is what makes
 * one box per project the fix rather than a reset: a reader who leaves a
 * project with a question typed and a send outstanding finds both where they
 * left them, and the pair they find is the one their send went out under.
 */
test("a bounce through another project leaves the first project's box as it was", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: answerLostThenTaken(),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  await server.moveTo(elsewhere);
  await turned(() => {
    typed("what is beta waiting on?");
  });
  await turned(ask);
  await settled();
  await server.moveTo(leadPartition);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Question").value,
    "a reader came back to a project and found their question gone",
  ).toBe("why is ticket 41 waiting?");
  await turned(ask);
  await settled();
  const sent = sessionsPosted(server);
  expect(server.postUrls()[2]).toContain("/projects/atlas/lead/inquiries");
  expect(
    sent[2],
    "a bounce through another project made this project's door fork twice",
  ).toBe(sent[0]);
  expect(sent[1]).not.toBe(sent[0]);
});

/**
 * A PRESS OUTSTANDING FOR ONE PROJECT SAYS NOTHING ON ANOTHER'S PAGE, and
 * blocks nothing there either: the answer is written to the box it was asked
 * from, so a reader who switches while a send is in flight sees the project
 * they switched to and can ask it something of their own.
 */
test("a press outstanding for one project neither speaks nor blocks on another's page", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asks = 0;
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => {
      asks += 1;
      return asks === 1 ? refusal("InquiriesInFlight") : refusal("LeadClosed");
    },
    gate: () => (asks === 1 ? gate : Promise.resolve()),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await server.moveTo(elsewhere);
  expect(screen.queryByText("Asking")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Ask" }).getAttribute("aria-busy"),
    "one project's press made another project's box busy",
  ).not.toBe("true");
  await turned(() => {
    typed("what is beta waiting on?");
  });
  await turned(ask);
  await settled();
  expect(
    server.postUrls()[1],
    "a press on one project was swallowed by another project's press",
  ).toContain("/projects/beta/lead/inquiries");
  expect(screen.getByText("Closed")).toBeDefined();
  await turned(release);
  await settled();
  expect(
    screen.queryByText("In flight"),
    "one project's refusal was drawn on another project's page",
  ).toBeNull();
  expect(screen.getByText("Closed")).toBeDefined();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Question").value,
    "one project's answer took away what another project's reader typed",
  ).toBe("what is beta waiting on?");
  await server.moveTo(leadPartition);
  expect(
    screen.getByText("In flight"),
    "the answer never reached the box that asked for it",
  ).toBeDefined();
});

/**
 * The second half of the same fault, and the worse one: a pair the installation
 * has already used is refused, and a pair still held is re-sent on every press,
 * so the box never recovers until the reader edits or reloads.
 */
test("a box carried into another project is not wedged", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: uniqueDoor(),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(
    screen.getByText(/^Failed · /u),
    "the door was meant to take the name and lose the answer",
  ).toBeDefined();
  await server.moveTo(elsewhere);
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(
    screen.getByText("Asked"),
    "the box was left re-sending a pair the installation had already used",
  ).toBeDefined();
  expect(screen.queryByText(/^Failed · /u)).toBeNull();
  const sent = sessionsPosted(server);
  expect(sent[1]).not.toBe(sent[0]);
});

/**
 * WHAT THE BOX LAST SAID IS ABOUT ONE PROJECT'S DOOR. Carried to the next
 * project it is a statement this panel would be making about a lead it never
 * asked, and the reader has no way to tell which project it is about.
 */
test("one project's last word is not drawn on another's page", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => refusal("InquiriesInFlight"),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  expect(screen.getByText("In flight")).toBeDefined();
  await server.moveTo(elsewhere);
  expect(
    screen.queryByText("In flight"),
    "one project's refusal was drawn on another project's page",
  ).toBeNull();
});

/**
 * AN ACCEPTED PRESS RE-READS THE PROJECT IT WAS ASKED IN. The answer may arrive
 * after the reader has moved on, and re-reading whichever project is on screen
 * would leave the asked project's listing without the inquiry that was just
 * opened while re-reading a project nothing happened to.
 */
test("an accepted press re-reads the project it was asked in", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    gate: () => gate,
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await server.moveTo(elsewhere);
  const staleness = (partition: PartitionIdentity) =>
    server.client.getQueryState(
      projectListRereadNamed<unknown>(
        partition,
        "Session",
        leadInquiriesListName,
        () => true,
      ).key,
    )?.isInvalidated;
  await turned(release);
  await settled();
  expect(
    staleness(leadPartition),
    "the project the question was asked in was never marked for re-reading",
  ).toBe(true);
  expect(
    staleness(elsewhere),
    "a project nothing was asked in was marked stale instead",
  ).not.toBe(true);
});

/** An edited question is a different question, and the held pair would have the
 * door answer it with the first question's own ordinal. */
test("an edited question takes a pair of its own", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => ({
      body: { error: { code: "InternalError", message: "no" } },
      status: 500,
    }),
  });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await settled();
  await turned(() => {
    typed("why is ticket 42 waiting?");
  });
  await turned(ask);
  await settled();
  const sent = server.posts() as readonly {
    readonly session: string;
    readonly question: string;
  }[];
  expect(sent.map((post) => post.question)).toStrictEqual([
    "why is ticket 41 waiting?",
    "why is ticket 42 waiting?",
  ]);
  expect(
    sent[1]?.session,
    "an edited question went out under the pair drawn for another one",
  ).not.toBe(sent[0]?.session);
});

/**
 * AN ANSWER TAKES AWAY THE QUESTION IT ANSWERED AND NEVER THE NEXT ONE. A reader
 * who types again while a send is outstanding has moved on, and emptying the box
 * on that send's success would be this panel editing a question they had not
 * asked yet.
 */
test("an accepted answer leaves a question typed since it was sent", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await drawInquiries({ listing: () => ({ inquiries: [] }), gate: () => gate });
  await turned(() => {
    typed("why is ticket 41 waiting?");
  });
  await turned(ask);
  await turned(() => {
    typed("what is ticket 42 waiting on?");
  });
  await turned(release);
  await settled();
  expect(screen.getByText("Asked")).toBeDefined();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Question").value,
    "an answer took away a question asked after the one it answered",
  ).toBe("what is ticket 42 waiting on?");
});

/** A pair the door has taken is spent, so the same question asked again is a
 * new question and not a retry of the answered one. */
test("a question asked again after it was answered takes a new pair", async () => {
  const server = await drawInquiries({
    listing: () => ({ inquiries: [] }),
    asked: () => ({
      body: { session: "inq-new", turn: "inq-turn-new", ordinal: 1 },
      status: 202,
    }),
  });
  const asking = async () => {
    await turned(() => {
      typed("why is ticket 41 waiting?");
    });
    await turned(ask);
    await settled();
  };
  await asking();
  await asking();
  const sent = sessionsPosted(server);
  expect(sent.length).toBe(2);
  expect(
    sent[1],
    "a pair the door had already taken was sent a second time",
  ).not.toBe(sent[0]);
});
