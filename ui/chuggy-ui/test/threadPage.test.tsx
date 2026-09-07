/**
 * One member's thread as a conversation: what the store's chain draws, what the
 * mailbox adds to it, who may type into it, and whether the page moves when its
 * session does.
 *
 * THE CLOSE IS PRESSED ON ANOTHER MEMBER'S THREAD, because the door is the
 * project's and a page that offered it on the reader's own alone would look
 * right there and hide the orphaned thread's control.
 *
 * THE LIVE CASE AND THE COMPOSER CASE BOTH HAVE A FALSIFYING TWIN. A page that
 * re-read on every `Session` frame would look right in the live case and would
 * re-read every thread's page on every other thread's turn, so the twin pushes
 * another session's frame and asserts the page did NOT move; a page that drew
 * the composer from anything but the read's own `mine` would look right on the
 * reader's own thread, so the twin draws another member's and asserts there is
 * no box at all.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ThreadPage } from "../app/browser/ThreadPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { ShellSlotHarness, styleless } from "./shellSlotHarness.tsx";
import { frame } from "./streamDouble.ts";
import {
  threadMessageCharsMax,
  threadTurnsAnsweredMax,
} from "../../../src/contract/http.ts";
import type { ThreadTranscriptResponse } from "../../../src/contract/responses.ts";
import {
  threadBody,
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
  threadSessionResource,
  threadTranscriptPage,
  threadTranscriptSaid,
  threadTurn,
  threadWakeInput,
  threadWakeStandingSaid,
} from "./threadFixture.ts";
import { viewportAtEm } from "./viewport.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

const routed = { session: threadMineSession };

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...threadPartition, ...routed }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  routed.session = threadMineSession;
  vi.unstubAllGlobals();
});

interface ThreadServed {
  readonly thread: ReturnType<typeof threadBody>;
  /** The store this thread has written, where a case needs one of its own. */
  readonly transcript?: (after: number) => ThreadTranscriptResponse;
}

/** The body and status every route this page reads answers with. */
function threadRouteAnswer(
  url: string,
  served: ThreadServed,
): { readonly body: unknown; readonly status: number } {
  if (url.includes("/transcript")) {
    const asked = new URL(url, "https://console").searchParams.get("after");
    const walked = served.transcript ?? threadTranscriptPage;
    return { body: walked(Number(asked ?? "0")), status: 200 };
  }
  if (url.includes("/threads/")) return { body: served.thread, status: 200 };
  return {
    body: { partition: threadPartition, sequence: 1, tickets: [] },
    status: 200,
  };
}

async function mountThread(): Promise<ReturnType<typeof openedStream>> {
  const server = openedStream();
  render(
    <ScreenHarness
      partition={threadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <ShellSlotHarness>
        <ThreadPage />
      </ShellSlotHarness>
    </ScreenHarness>,
  );
  await settled();
  styleless();
  return server;
}

/** The page over a server answering the thread route from one held body, with
 * every post recorded so a case can read what was sent. */
function drawThread(
  holding: () => ThreadServed,
  posting: () => { readonly body: unknown; readonly status: number } = () => ({
    body: { turn: "thread-turn-x", ordinal: 4 },
    status: 202,
  }),
): {
  readonly posts: () => readonly unknown[];
  readonly posted: () => readonly string[];
} {
  const posts: unknown[] = [];
  const posted: string[] = [];
  const fetching = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "null"));
      posted.push(url);
      const sent = posting();
      return Promise.resolve(answer(sent.body, sent.status));
    }
    const found = threadRouteAnswer(url, holding());
    return Promise.resolve(answer(found.body, found.status));
  };
  vi.stubGlobal("fetch", fetching);
  return { posts: () => posts, posted: () => posted };
}

function composer(): HTMLTextAreaElement | null {
  return screen.queryByRole<HTMLTextAreaElement>("textbox");
}

/** The box, insisted on: a case that meant to type into a composer and found
 * none has failed rather than found a null to work around. */
function typing(): HTMLTextAreaElement {
  const box = composer();
  if (box === null) throw new Error("this thread drew no composer");
  return box;
}

/** One message typed and sent, which every press case does the same way. */
async function pressed(said: string): Promise<void> {
  await turned(() => {
    fireEvent.change(typing(), { target: { value: said } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
  styleless();
}

test("the head names the thread, its standing and whose it is", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(screen.getByRole("heading", { name: "Thread" })).toBeDefined();
  expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
  expect(screen.getByText("Yours")).toBeDefined();
  expect(screen.getAllByText("geoff").length).toBeGreaterThan(0);
});

/** A titled thread is headed by what is in it; a thread nobody has written in
 * has nothing to derive one from, and the bar says what the page is. */
test("the head is the thread's title where the read derived one", async () => {
  drawThread(() => ({ thread: { ...threadBody({}), title: "ship it" } }));
  await mountThread();
  expect(screen.getByRole("heading", { name: "ship it" })).toBeDefined();
  expect(screen.getByText("Yours")).toBeDefined();
});

/** The bar's own title never wraps, so a narrow reader needs its chips to run
 * onto a line of their own rather than under the details toggle. */
test("the bar's chips wrap on their own rather than crowd the title", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  const chips = screen.getByRole("heading", {
    name: "Thread",
  }).nextElementSibling;
  expect(chips?.className).toContain("flex-wrap");
});

/**
 * The close is any reader's, so the case presses it on ANOTHER member's thread;
 * and the page refreshes nothing itself — the frame does — so what is asserted
 * is the one post and where it went.
 */
test("Close on any open thread posts to its close route and nothing else", async () => {
  routed.session = threadOtherSession;
  const server = drawThread(
    () => ({
      thread: threadBody({
        session: threadOtherSession,
        mine: false,
        owner: "ada",
      }),
    }),
    () => ({
      body: threadEntry({ session: threadOtherSession, state: "Closed" }),
      status: 200,
    }),
  );
  await mountThread();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
  await settled();
  styleless();
  expect(server.posted()).toStrictEqual([
    `/api/v1/tenants/acme/projects/atlas/threads/${threadOtherSession}/close`,
  ]);
  expect(server.posts()).toStrictEqual([{}]);
  expect(screen.queryByText(/^Refused · /u)).toBeNull();
});

test("a closed thread offers no Close, and an orphaned one does", async () => {
  drawThread(() => ({ thread: threadBody({ state: "Closed" }) }));
  await mountThread();
  expect(
    screen.queryByRole("button", { name: "Close" }),
    "a thread already closed was offered a close",
  ).toBeNull();
  cleanup();
  drawThread(() => ({ thread: threadBody({ orphaned: true }) }));
  await mountThread();
  expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
});

test("a close the server refused says so and leaves the standing alone", async () => {
  drawThread(
    () => ({ thread: threadBody({}) }),
    () => ({
      body: { error: { code: "Forbidden", message: "no" } },
      status: 403,
    }),
  );
  await mountThread();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
  await settled();
  styleless();
  expect(screen.getByText(/^Refused · /u)).toBeDefined();
  expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
});

test("my thread draws a composer", async () => {
  drawThread(() => ({ thread: threadBody({ mine: true }) }));
  await mountThread();
  expect(composer()).not.toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
});

/**
 * The falsifying twin of the case above. A composer drawn from anything but the
 * read's own `mine` — the session in the address bar, a token this browser
 * decoded — would draw here too, and the door would refuse every press.
 */
test("another member's thread draws no composer at all", async () => {
  routed.session = threadOtherSession;
  drawThread(() => ({
    thread: threadBody({
      session: threadOtherSession,
      mine: false,
      owner: "ada",
    }),
  }));
  await mountThread();
  expect(
    composer(),
    "a thread that is not mine offered a message box",
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test("Send posts the typed message under a minted turn and clears on 202", async () => {
  const server = drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  await pressed("look at ticket 41");
  const posted = server.posts()[0] as {
    readonly turn: string;
    readonly message: string;
  };
  expect(server.posts().length).toBe(1);
  expect(posted.message).toBe("look at ticket 41");
  expect(posted.turn.startsWith("thread-turn-")).toBe(true);
  expect(composer()?.value).toBe("");
});

/**
 * A backlogged mailbox keeps the text, because the reader has to be able to
 * press again — and the press that follows must reach the SAME row, since
 * enqueuing is idempotent on the turn and a fresh identity would put a second
 * copy of one message in the mailbox. The box clears at dispatch, so keeping it
 * is the page handing the characters back.
 */
test("a backlogged mailbox draws the notice, keeps the text and retries the same turn", async () => {
  const server = drawThread(
    () => ({ thread: threadBody({}) }),
    () => ({
      body: { error: { code: "ThreadBacklogged", message: "wait" } },
      status: 429,
    }),
  );
  await mountThread();
  await pressed("one more");
  expect(screen.getByText("Backlogged")).toBeDefined();
  expect(composer()?.value, "a backlogged press threw the typing away").toBe(
    "one more",
  );
  const first = server.posts()[0] as { readonly turn: string };
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
  styleless();
  const later = server.posts().at(-1) as { readonly turn: string };
  expect(
    later.turn,
    "pressing again after a backlog minted a second turn for one message",
  ).toBe(first.turn);
});

/**
 * ONCE THE MAILBOX HAS ACCEPTED THE TEXT, THE IDENTITY IS SPENT. Enqueuing is
 * idempotent on the turn, so a second `ping` posted under the first `ping`'s
 * identity is never enqueued: the door answers 202 with the ordinal it already
 * had and the box clears, telling a member a message landed that the thread
 * will never see.
 */
test("an identical message sent again is a turn of its own", async () => {
  const server = drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  await pressed("ping");
  await pressed("ping");
  const posted = server.posts() as readonly { readonly turn: string }[];
  expect(posted.length).toBe(2);
  expect(
    posted[1]?.turn,
    "a repeated message was posted under the turn the mailbox already answered",
  ).not.toBe(posted[0]?.turn);
});

/** What the last press said is about the last press: a backlog line left under
 * the box reports a refusal that the text now in it has never met. */
test("a wait the reader has typed past is no longer said", async () => {
  drawThread(
    () => ({ thread: threadBody({}) }),
    () => ({
      body: { error: { code: "ThreadBacklogged", message: "wait" } },
      status: 429,
    }),
  );
  await mountThread();
  await pressed("one");
  expect(screen.getByText("Backlogged")).toBeDefined();
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "one more" } });
  });
  expect(
    screen.queryByText("Backlogged"),
    "a backlog was still reported over text that had never been sent",
  ).toBeNull();
});

/** Editing the text releases the identity: posting a correction under the turn
 * the mailbox already answered would report the correction as landed. */
test("editing after a refusal posts under a turn of its own", async () => {
  let refusing = true;
  const server = drawThread(
    () => ({ thread: threadBody({}) }),
    () =>
      refusing
        ? {
            body: { error: { code: "ThreadBacklogged", message: "wait" } },
            status: 429,
          }
        : { body: { turn: "thread-turn-x", ordinal: 4 }, status: 202 },
  );
  await mountThread();
  await pressed("first");
  refusing = false;
  await pressed("second");
  const first = server.posts()[0] as { readonly turn: string };
  const later = server.posts().at(-1) as { readonly turn: string };
  expect(
    later.turn,
    "a corrected message was posted under the turn the mailbox already held",
  ).not.toBe(first.turn);
});

/** A door that will take no more messages ends the composer and says which
 * refusal it was, so a thread whose owner is no longer a member is told apart
 * from one that was closed. */
async function pressedAgainst(code: string): Promise<{
  readonly posts: () => readonly unknown[];
}> {
  const server = drawThread(
    () => ({ thread: threadBody({}) }),
    () => ({ body: { error: { code, message: "no" } }, status: 409 }),
  );
  await mountThread();
  await pressed("anything");
  return server;
}

/**
 * A 403 arrives when the URL's session is not the mailbox the caller's own
 * principal resolves to — and the door resolves before it compares, so in the
 * close-and-reopen race the turn is already enqueued in the mailbox that
 * resolved. Sending again would put a second copy of one message in it.
 */
async function pressedAgainstDispute(holding: () => boolean): Promise<{
  readonly sends: () => readonly unknown[];
}> {
  const sends: unknown[] = [];
  const fetching = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "null") as { readonly turn: string };
      sends.push(body);
      if (url.includes(`/threads/${threadOtherSession}/messages`))
        return Promise.resolve(
          answer(
            { error: { code: "NotYourThread", message: "elsewhere" } },
            403,
          ),
        );
      return Promise.resolve(answer({ turn: body.turn, ordinal: 7 }, 202));
    }
    if (url.includes("/transcript"))
      return Promise.resolve(answer(threadTranscriptPage(1)));
    if (url.endsWith("/threads")) {
      return Promise.resolve(
        answer({
          threads: [
            threadEntry({ session: threadMineSession, mine: true }),
            threadEntry({ session: threadOtherSession }),
          ],
        }),
      );
    }
    if (url.includes(`/threads/${threadMineSession}`))
      return Promise.resolve(
        answer(
          threadBody({
            session: threadMineSession,
            turns: holding()
              ? [
                  threadTurn({
                    turn: (sends[0] as { readonly turn: string }).turn,
                    ordinal: 7,
                  }),
                ]
              : [threadTurn({ turn: "thread-turn-other", ordinal: 6 })],
          }),
        ),
      );
    if (url.includes("/threads/"))
      return Promise.resolve(
        answer(
          threadBody({
            session: threadOtherSession,
            mine: true,
            owner: "geoff",
          }),
        ),
      );
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  routed.session = threadOtherSession;
  await mountThread();
  await pressed("into the race");
  return { sends: () => sends };
}

test("a NotYourThread whose message already landed is not sent again", async () => {
  const run = await pressedAgainstDispute(() => true);
  const sends = run.sends() as readonly { readonly turn: string }[];
  expect(
    sends.length,
    "a message the resolved mailbox already held was sent a second time",
  ).toBe(1);
  expect(composer()?.value, "a message that landed was left in the box").toBe(
    "",
  );
});

test("a NotYourThread whose message did not land is sent again under the same turn", async () => {
  const run = await pressedAgainstDispute(() => false);
  const sends = run.sends() as readonly { readonly turn: string }[];
  expect(sends.length).toBe(2);
  expect(
    sends[1]?.turn,
    "the second send minted a fresh identity the door could not dedupe",
  ).toBe(sends[0]?.turn);
  expect(composer()?.value).toBe("");
});

test("a closed thread stops the composer sending", async () => {
  const server = await pressedAgainst("ThreadClosed");
  expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
  expect(
    composer(),
    "a door that answered Closed left a box to shout into",
  ).toBeNull();
  expect(server.posts().length).toBe(1);
});

test("a thread whose owner is gone stops it too, and says which", async () => {
  const server = await pressedAgainst("ThreadOrphaned");
  expect(
    screen.getByText("Orphaned"),
    "one refusal was drawn as another",
  ).toBeDefined();
  expect(composer()).toBeNull();
  expect(server.posts().length).toBe(1);
});

test("the composer bounds what one message may carry", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(composer()?.maxLength).toBe(threadMessageCharsMax);
});

/** A thread the read already says takes no more messages is not a box a member
 * types into to earn the refusal. */
test("a thread already standing Closed draws a composer that takes nothing", async () => {
  const server = drawThread(() => ({
    thread: threadBody({ state: "Closed" }),
  }));
  await mountThread();
  expect(composer()).toBeNull();
  expect(server.posts().length).toBe(0);
});

/**
 * A second turn landing in the mailbox, announced by one frame; it is queued,
 * because an answered turn lives in the transcript and the mailbox adds nothing
 * to it. What differs between the three cases below is only what the frame's
 * resource says, so the page that must move and the two that must not are one
 * arrangement asked three questions.
 */
async function afterFrame(sequence: string, resource: string): Promise<void> {
  let served: ThreadServed = { thread: threadBody({}) };
  drawThread(() => served);
  const server = await mountThread();
  served = {
    thread: threadBody({
      turns: [
        threadTurn({ turn: "thread-turn-1" }),
        threadTurn({
          turn: "thread-turn-2",
          ordinal: 2,
          state: "Queued",
          input: "and 42?",
        }),
      ],
    }),
  };
  await turned(() => {
    server.push(
      frame("Session", sequence, {
        version: 1,
        resource,
        representation: null,
      }),
    );
  });
  await settled();
}

/**
 * A turn moving arrives as a `Session` frame naming this thread. The frame is a
 * pointer and carries no body, so the page re-reads; one that did not register
 * the kind would sit on the turn it opened with while the thread went on
 * answering, and would look exactly like a thread with nothing to report.
 */
test("a Session frame naming this thread draws the turn that arrived", async () => {
  await afterFrame(
    "70",
    threadSessionResource(threadMineSession, "thread-turn-2"),
  );
  expect(screen.getByText("and 42?")).toBeDefined();
  expect(screen.getByText("Queued")).toBeDefined();
});

/** The falsifying twin: a project holds a session per member beside its lead,
 * so a page watching one must not re-read on another's frame. */
test("a Session frame naming another session leaves the page alone", async () => {
  await afterFrame(
    "71",
    threadSessionResource(threadOtherSession, "thread-turn-9"),
  );
  expect(
    screen.queryByText("and 42?"),
    "another member's thread moving re-read this one's page",
  ).toBeNull();
});

/** A resource this console cannot read is a frame it ignores, rather than one
 * that ends the stream and stops every other kind with it. */
test("a Session frame carrying a bare session id is ignored", async () => {
  await afterFrame("72", threadMineSession);
  expect(screen.queryByText("and 42?")).toBeNull();
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();
});

/** An empty answer block below a question reads as an answer of nothing, which
 * is the one thing a page must not say about a turn still in the mailbox. */
test("a turn still queued draws as a running exchange with the typed text", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          state: "Queued",
          input: "waiting on this",
          result: "an answer no queued turn has",
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("Queued")).toBeDefined();
  expect(screen.getByText("waiting on this")).toBeDefined();
  expect(
    screen.queryByText("an answer no queued turn has"),
    "a turn nobody has claimed was drawn with an answer",
  ).toBeNull();
});

test("a claimed turn draws no answer either", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          state: "Claimed",
          input: "still going",
          result: "an answer no claimed turn has",
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("Claimed")).toBeDefined();
  expect(screen.queryByText("an answer no claimed turn has")).toBeNull();
});

/**
 * Everything between the ask and the answer sits behind one collapsed line. A
 * page that drew the calls beside the answer would bury a member's own
 * conversation under the agent's working.
 */
test("a transcript tool call sits inside the collapsed work disclosure", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(screen.getByText("a member's question")).toBeDefined();
  expect(screen.getByText("it waits on 40")).toBeDefined();
  expect(screen.queryByText("41 waits on 40")).toBeNull();
  const work = screen.getByRole("button", { name: /tool/u });
  fireEvent.click(work);
  const call = screen.getByRole("button", { name: /Read/u });
  expect(screen.queryByText("41 waits on 40")).toBeNull();
  fireEvent.click(call);
  expect(screen.getByText("41 waits on 40")).toBeDefined();
});

/**
 * A wake's input is the document the runtime composed, and the worker hands the
 * runtime that document verbatim — so the transcript holds it as the entry the
 * turn pairs with. The standing sentence in it is an instruction to the agent
 * and the JSON is not something a member typed, so what a reader gets is the
 * reason and the resource.
 */
test("a wake draws its reason and its resource and not its document", async () => {
  const woken = threadWakeInput("TicketRefused", "41");
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          inputKind: "Wake",
          input: woken,
        }),
      ],
    }),
    transcript: (after) => threadTranscriptSaid(after, woken),
  }));
  await mountThread();
  expect(screen.getByText("TicketRefused · 41")).toBeDefined();
  expect(
    screen.queryByText(threadWakeStandingSaid),
    "the rule the agent is bound by was drawn as copy for a reader",
  ).toBeNull();
  expect(
    document.body.textContent?.includes('"standing"'),
    "a wake turn drew its raw document",
  ).toBe(false);
});

/** A wake this console cannot read out of the input is drawn as the kind alone,
 * rather than as whatever the document happened to be. */
test("a wake whose document will not parse draws no input block", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          inputKind: "Wake",
          input: "not a document",
        }),
      ],
    }),
    transcript: (after) => threadTranscriptSaid(after, "not a document"),
  }));
  await mountThread();
  expect(screen.getByText("Wake")).toBeDefined();
  expect(screen.queryByText("not a document")).toBeNull();
});

test("a failed turn says how it failed rather than drawing an empty answer", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          state: "Failed",
          result: undefined,
          failure: "AgentRateLimited",
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("Failed")).toBeDefined();
  expect(screen.getByText("AgentRateLimited")).toBeDefined();
});

/** An open thread whose owner's membership is gone still acts, and an
 * administrator has to be able to see that it does. */
test("a thread whose owner is gone stands Orphaned", async () => {
  drawThread(() => ({
    thread: threadBody({ orphaned: true, mine: false }),
  }));
  await mountThread();
  expect(screen.getAllByText("Orphaned").length).toBeGreaterThan(0);
});

/** The transcript is the lead's own walk over a different session's store, and
 * a page that reached the lead's route would draw the lead's chain here. */
test("the transcript is walked over this thread's own route", async () => {
  const asked: string[] = [];
  const fetching = (url: string): Promise<Response> => {
    if (url.includes("/transcript")) asked.push(url);
    const found = threadRouteAnswer(url, { thread: threadBody({}) });
    return Promise.resolve(answer(found.body, found.status));
  };
  vi.stubGlobal("fetch", fetching);
  await mountThread();
  expect(asked.length).toBeGreaterThan(0);
  expect(
    asked.every((url) => url.includes(`/threads/${threadMineSession}/`)),
    "a thread's transcript was paged from the lead's route",
  ).toBe(true);
  expect(screen.getByText("a member's question")).toBeDefined();
});

test("a project with no such thread is a page saying so", async () => {
  const fetching = (url: string): Promise<Response> =>
    Promise.resolve(
      url.includes("/threads/")
        ? answer({ error: { code: "NotFound", message: "no" } }, 404)
        : answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  vi.stubGlobal("fetch", fetching);
  await mountThread();
  expect(screen.getByRole("heading", { name: "No thread" })).toBeDefined();
});

/** The tail is bounded on the wire, so a read carrying more turns than the
 * bound is a body this console refuses rather than a page it draws. */
test("a mailbox tail over the answered bound is refused, not drawn", async () => {
  const fetching = (url: string): Promise<Response> => {
    if (url.includes("/transcript"))
      return Promise.resolve(answer(threadTranscriptPage(1)));
    if (url.includes("/threads/"))
      return Promise.resolve(
        answer({
          ...threadBody({}),
          turns: Array.from(
            { length: threadTurnsAnsweredMax + 1 },
            (_unused, at) =>
              threadTurn({
                turn: `thread-turn-${String(at)}`,
                ordinal: at + 1,
              }),
          ),
        }),
      );
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  await mountThread();
  expect(
    screen.getByText(/^Failed to load · /u),
    "a page longer than the wire allows was drawn instead of refused",
  ).toBeDefined();
});
