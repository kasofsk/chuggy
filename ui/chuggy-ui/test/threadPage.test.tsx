/**
 * One member's thread: who may type into it, what a turn draws before it is
 * answered, what a wake is drawn as, and whether the page moves when its session
 * does.
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
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ThreadPage } from "../app/browser/ThreadPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import {
  threadMessageCharsMax,
  threadTurnsAnsweredMax,
} from "../../../src/contract/http.ts";
import {
  threadBody,
  threadMineSession,
  threadOtherSession,
  threadPartition,
  threadSessionResource,
  threadTranscriptPage,
  threadTurn,
  threadWakeInput,
  threadWakeStandingSaid,
} from "./threadFixture.ts";
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

afterEach(() => {
  cleanup();
  routed.session = threadMineSession;
  vi.unstubAllGlobals();
});

interface ThreadServed {
  readonly thread: ReturnType<typeof threadBody>;
}

/** The body and status every route this page reads answers with. */
function threadRouteAnswer(
  url: string,
  served: ThreadServed,
): { readonly body: unknown; readonly status: number } {
  if (url.includes("/transcript")) {
    const asked = new URL(url, "https://console").searchParams.get("after");
    return { body: threadTranscriptPage(Number(asked ?? "0")), status: 200 };
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
      <ThreadPage />
    </ScreenHarness>,
  );
  await settled();
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
): { readonly posts: () => readonly unknown[] } {
  const posts: unknown[] = [];
  const fetching = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "null"));
      const sent = posting();
      return Promise.resolve(answer(sent.body, sent.status));
    }
    const found = threadRouteAnswer(url, holding());
    return Promise.resolve(answer(found.body, found.status));
  };
  vi.stubGlobal("fetch", fetching);
  return { posts: () => posts };
}

function composer(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(
    ".thread-composer textarea",
  );
}

/** The box, insisted on: a case that meant to type into a composer and found
 * none has failed rather than found a null to work around. */
function typing(): HTMLTextAreaElement {
  const box = composer();
  if (box === null) throw new Error("this thread drew no composer");
  return box;
}

function turnBlocks(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".thread-turn")];
}

test("the head names the thread, its standing and whose it is", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(screen.getByRole("heading", { name: "Thread" })).toBeDefined();
  expect(screen.getAllByText(threadMineSession).length).toBeGreaterThan(0);
  expect(screen.getByText("Open")).toBeDefined();
  expect(screen.getByText("Mine")).toBeDefined();
  expect(screen.getByText("geoff")).toBeDefined();
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
  const box = typing();
  await turned(() => {
    fireEvent.change(box, { target: { value: "look at ticket 41" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
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
 * copy of one message in the mailbox.
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
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "one more" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
  expect(screen.getByText("Backlogged")).toBeDefined();
  expect(composer()?.value, "a backlogged press threw the typing away").toBe(
    "one more",
  );
  const first = server.posts()[0] as { readonly turn: string };
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
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
  const press = async (said: string): Promise<void> => {
    await turned(() => {
      fireEvent.change(typing(), { target: { value: said } });
    });
    await turned(() => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await settled();
  };
  await press("ping");
  await press("ping");
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
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "one" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
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
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "first" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
  refusing = false;
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "second" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
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
async function pressedAgainst(code: string): Promise<void> {
  drawThread(
    () => ({ thread: threadBody({}) }),
    () => ({ body: { error: { code, message: "no" } }, status: 409 }),
  );
  await mountThread();
  await turned(() => {
    fireEvent.change(typing(), { target: { value: "anything" } });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
}

test("a closed thread stops the composer taking typing", async () => {
  await pressedAgainst("ThreadClosed");
  expect(screen.getByText("Closed")).toBeDefined();
  expect(composer()?.disabled).toBe(true);
});

test("a thread whose owner is gone stops it too, and says which", async () => {
  await pressedAgainst("ThreadOrphaned");
  expect(
    screen.getByText("Orphaned"),
    "one refusal was drawn as another",
  ).toBeDefined();
  expect(composer()?.disabled).toBe(true);
});

test("the composer bounds what one message may carry", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(composer()?.maxLength).toBe(threadMessageCharsMax);
});

/**
 * A second turn landing in the mailbox, announced by one frame. What differs
 * between the three cases below is only what the frame's resource says, so the
 * page that must move and the two that must not are one arrangement asked three
 * questions.
 */
async function afterFrame(sequence: string, resource: string): Promise<number> {
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
          input: "and 42?",
          result: "42 is done",
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
  return turnBlocks().length;
}

/**
 * A turn moving arrives as a `Session` frame naming this thread. The frame is a
 * pointer and carries no body, so the page re-reads; one that did not register
 * the kind would sit on the turn it opened with while the thread went on
 * answering, and would look exactly like a thread with nothing to report.
 */
test("a Session frame naming this thread moves the turn tail", async () => {
  const drawn = await afterFrame(
    "70",
    threadSessionResource(threadMineSession, "thread-turn-2"),
  );
  expect(drawn).toBe(2);
  expect(screen.getByText("42 is done")).toBeDefined();
});

/** The falsifying twin: a project holds a session per member beside its lead,
 * so a page watching one must not re-read on another's frame. */
test("a Session frame naming another session leaves the page alone", async () => {
  expect(
    await afterFrame(
      "71",
      threadSessionResource(threadOtherSession, "thread-turn-9"),
    ),
    "another member's thread moving re-read this one's page",
  ).toBe(1);
});

/** A resource this console cannot read is a frame it ignores, rather than one
 * that ends the stream and stops every other kind with it. */
test("a Session frame carrying a bare session id is ignored", async () => {
  expect(await afterFrame("72", threadMineSession)).toBe(1);
  expect(screen.queryByText(/^Failed to load · /u)).toBeNull();
});

/** An empty answer block below a question reads as an answer of nothing, which
 * is the one thing a page must not say about a turn still in the mailbox. */
test("a turn still queued draws its state and no answer block", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          state: "Queued",
          input: "waiting on this",
          result: "an answer no queued turn has",
          model: undefined,
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("Queued")).toBeDefined();
  expect(screen.getByText("waiting on this")).toBeDefined();
  expect(
    document.querySelectorAll(".thread-answer").length,
    "a turn nobody has claimed was drawn with an answer block",
  ).toBe(0);
  expect(screen.queryByText("an answer no queued turn has")).toBeNull();
});

test("a claimed turn draws no answer block either", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          state: "Claimed",
          result: "an answer no claimed turn has",
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("Claimed")).toBeDefined();
  expect(document.querySelectorAll(".thread-answer").length).toBe(0);
});

/** `UserMessage` is what the mailbox calls a member's turn and `Message` is
 * what a member calls it; the wire's word reaching the page is the console's
 * nouns-only standard broken by the one roster nothing mapped. */
test("a member's own turn is drawn as a Message", async () => {
  drawThread(() => ({ thread: threadBody({}) }));
  await mountThread();
  expect(
    document.querySelector(".thread-turn-head .eyebrow")?.textContent,
    "the wire's own word for a member's turn reached the reader",
  ).toBe("Message");
});

/**
 * The read is the newest page and the reader walks back from it. A page that
 * ignored `nextBefore` would leave the top of a long conversation unreachable,
 * and one that drew the pages in arrival order would put the older page after
 * the newer.
 */
test("Older walks back from the read's cursor and draws the mailbox in order", async () => {
  const asked: string[] = [];
  const fetching = (url: string): Promise<Response> => {
    if (url.includes("/transcript"))
      return Promise.resolve(answer(threadTranscriptPage(1)));
    if (url.includes("/threads/")) {
      const before = new URL(url, "https://console").searchParams.get("before");
      if (before === null)
        return Promise.resolve(
          answer(
            threadBody({
              nextBefore: 8,
              turns: [
                threadTurn({ turn: "t-8", ordinal: 8, input: "the newer" }),
              ],
            }),
          ),
        );
      asked.push(before);
      return Promise.resolve(
        answer(
          threadBody({
            turns: [
              threadTurn({ turn: "t-7", ordinal: 7, input: "the older" }),
            ],
          }),
        ),
      );
    }
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  await mountThread();
  expect(screen.queryByText("the older")).toBeNull();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
  });
  await settled();
  expect(
    asked,
    "the walk asked from somewhere other than the read's cursor",
  ).toStrictEqual(["8"]);
  const said = [...document.querySelectorAll(".thread-said")].map(
    (block) => block.textContent,
  );
  expect(said).toStrictEqual(["the older", "the newer"]);
  expect(
    screen.queryByRole("button", { name: "Older" }),
    "a page with no cursor still offered an older one",
  ).toBeNull();
});

/**
 * A 40-turn thread answers its newest page with a cursor, the reader presses
 * `Older`, and then a turn lands and the frame slides the tail forward by one.
 * The turn that was the boundary falls into neither range, so a page drawing
 * the union omits a turn from the middle of a member's own conversation and
 * answers a cursor below the gathered set that no press can reach it through.
 */
test("a tail that slides while older pages are held leaves no turn unreachable", async () => {
  const page = (from: number, to: number, before?: number): unknown => ({
    ...threadBody({
      ...(before === undefined ? {} : { nextBefore: before }),
      turns: Array.from({ length: to - from + 1 }, (_unused, at) =>
        threadTurn({
          turn: `t-${String(from + at)}`,
          ordinal: from + at,
          input: `said ${String(from + at)}`,
        }),
      ),
    }),
  });
  let slid = false;
  const fetching = (url: string): Promise<Response> => {
    if (url.includes("/transcript"))
      return Promise.resolve(answer(threadTranscriptPage(1)));
    if (url.includes("/threads/")) {
      const asked = new URL(url, "https://console").searchParams.get("before");
      if (asked === null)
        return Promise.resolve(
          answer(slid ? page(10, 41, 10) : page(9, 40, 9)),
        );
      return Promise.resolve(answer(page(1, Number(asked) - 1)));
    }
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  const server = await mountThread();
  const ordinals = (): readonly number[] =>
    [...document.querySelectorAll(".thread-turn-head .num")].map((cell) =>
      Number(cell.textContent),
    );
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
  });
  await settled();
  expect(ordinals()[0]).toBe(1);
  slid = true;
  await turned(() => {
    server.push(
      frame("Session", "80", {
        version: 1,
        resource: threadSessionResource(threadMineSession, "t-41"),
        representation: null,
      }),
    );
  });
  await settled();
  const drawn = ordinals();
  const gaps = drawn.flatMap((ordinal, at) =>
    at > 0 && ordinal !== (drawn[at - 1] ?? 0) + 1 ? [ordinal] : [],
  );
  expect(
    gaps,
    "a turn fell between the tail and the pages behind it",
  ).toStrictEqual([]);
  expect(
    screen.queryByRole("button", { name: "Older" }),
    "the walk was left with no way back to what it dropped",
  ).not.toBeNull();
});

/** A thread the read already says takes no more messages is not a box a member
 * types into to earn the refusal. */
test("a thread already standing Closed draws a composer that takes nothing", async () => {
  drawThread(() => ({ thread: threadBody({ state: "Closed" }) }));
  await mountThread();
  expect(composer()?.disabled).toBe(true);
});

/**
 * A wake's input is the document the runtime composed. The standing sentence in
 * it is an instruction to the agent and the JSON is not something a member
 * typed, so what a reader gets is the reason and the resource.
 */
test("a wake draws its reason and its resource and not its document", async () => {
  drawThread(() => ({
    thread: threadBody({
      turns: [
        threadTurn({
          turn: "thread-turn-1",
          inputKind: "Wake",
          input: threadWakeInput("TicketRefused", "41"),
          result: "the lead refused 41",
        }),
      ],
    }),
  }));
  await mountThread();
  expect(screen.getByText("TicketRefused")).toBeDefined();
  expect(screen.getByText("41")).toBeDefined();
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
          result: "reported",
        }),
      ],
    }),
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
  expect(screen.getByText("Orphaned")).toBeDefined();
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
