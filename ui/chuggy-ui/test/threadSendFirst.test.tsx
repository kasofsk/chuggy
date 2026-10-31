/**
 * The composer of a reader with no thread: the first press opens one and sends
 * into it, and a press after that one was refused sends into the thread it
 * opened rather than opening another. And what the tenant's hosted grant does
 * to a composer, read before a press or met by one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionProvider } from "../app/browser/session.tsx";
import { useThreadSend } from "../app/browser/thread/threadSend.tsx";
import { answer, holderDouble, settled } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { threadEntry, threadPartition } from "./threadFixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Posted {
  readonly url: string;
  readonly body: unknown;
}

/** The door both scripted doors share: runs granted, the thread placed in the
 * cluster, every post recorded, and the thread and message answers the case
 * supplies. */
function doorStubbed(
  onThread: () => Response,
  onMessage: () => Response,
): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        answer(sessionPlacementBody({ thread: "InCluster" })),
      );
    posted.push({
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(url.endsWith("/threads") ? onThread() : onMessage());
  });
  return posted;
}

/** The door as the case scripts it: every open answers the same thread, and
 * each message is answered by the next status the case names. */
function doorAnswering(messageStatuses: readonly number[]): Posted[] {
  const statuses = [...messageStatuses];
  return doorStubbed(
    () => answer(threadEntry({ session: "thread-1", mine: true }), 201),
    () => {
      const status = statuses.shift() ?? 202;
      return status === 202
        ? answer({ turn: "t", ordinal: 1 }, 202)
        : answer({ error: { code: "Invalid" } }, status);
    },
  );
}

function wrapper(props: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SessionProvider holder={holderDouble()}>
        {props.children}
      </SessionProvider>
    </QueryClientProvider>
  );
}

test("a refused first message is sent again into the thread it opened", async () => {
  const posted = doorAnswering([400]);
  const started: string[] = [];
  const { result } = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: undefined,
        takes: true,
        onStarted: (session) => started.push(session),
      }),
    { wrapper },
  );
  let first: unknown;
  await act(async () => {
    first = await result.current.composer.onSend("hello", []);
  });
  expect(first).toBe("Kept");
  expect(started).toStrictEqual([]);
  let second: unknown;
  await act(async () => {
    second = await result.current.composer.onSend("hello", []);
  });
  expect(second).toBe("Sent");
  expect(started).toStrictEqual(["thread-1"]);
  expect(posted.filter((one) => one.url.endsWith("/threads"))).toHaveLength(1);
  const messages = posted.filter((one) => one.url.endsWith("/messages"));
  expect(messages.map((one) => one.url.includes("/thread-1/"))).toStrictEqual([
    true,
    true,
  ]);
  expect(messages[0]?.body).toStrictEqual(messages[1]?.body);
});

/** The door as the case scripts it: each open is answered the next answer the
 * case names, then the thread, and every message is taken. */
function doorOpening(openAnswers: readonly (() => Response)[]): Posted[] {
  const answers = [...openAnswers];
  const opened = () =>
    answer(threadEntry({ session: "thread-1", mine: true }), 201);
  return doorStubbed(
    () => (answers.shift() ?? opened)(),
    () => answer({ turn: "t", ordinal: 1 }, 202),
  );
}

/** The composer of a reader with no thread. */
function firstComposer(): ReturnType<
  typeof renderHook<ReturnType<typeof useThreadSend>, unknown>
> {
  return renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: undefined,
        takes: true,
      }),
    { wrapper },
  );
}

/** The open may have opened a thread its answer never reached, so the press
 * after it asks under the same key and is answered that thread. */
test("a first press whose open failed opens again under the same key", async () => {
  const posted = doorOpening([
    () => answer({ error: { code: "InternalError" } }, 500),
  ]);
  const { result } = firstComposer();
  await act(async () => {
    expect(await result.current.composer.onSend("hello", [])).toBe("Kept");
  });
  await act(async () => {
    expect(await result.current.composer.onSend("hello", [])).toBe("Sent");
  });
  const opens = posted.filter((one) => one.url.endsWith("/threads"));
  expect(opens).toHaveLength(2);
  expect(opens[1]?.body, "a retried open minted a fresh key").toStrictEqual(
    opens[0]?.body,
  );
});

test("a first press refused at the reader's thread limit says so and keeps the text", async () => {
  doorOpening([
    () => answer({ error: { code: "ThreadLimitReached" }, threadsMax: 1 }, 409),
  ]);
  const { result } = firstComposer();
  await act(async () => {
    expect(await result.current.composer.onSend("hello", [])).toBe("Kept");
  });
  render(<>{result.current.composer.note}</>);
  expect(screen.getByText("Not sent · Thread limit reached")).toBeTruthy();
});

/** A press's message is held under the turn it is posted as, which is what
 * lets the page draw it before the mailbox lists that turn. */
test("a press is held from the press, under the turn it posts, until the mailbox lists that turn", async () => {
  const posted = doorAnswering([202]);
  const { result, rerender } = renderHook(
    (listed: readonly string[]) =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
        listed,
      }),
    { wrapper, initialProps: [] as readonly string[] },
  );
  let sent: Promise<unknown> = Promise.resolve();
  act(() => {
    sent = result.current.composer.onSend("hello", []);
  });
  expect(result.current.sending.map((held) => held.text)).toStrictEqual([
    "hello",
  ]);
  await act(async () => {
    await sent;
  });
  const turn = (posted[0]?.body as { readonly turn: string }).turn;
  expect(result.current.sending).toStrictEqual([{ turn, text: "hello" }]);
  rerender(["some-other-turn"]);
  expect(result.current.sending).toStrictEqual([{ turn, text: "hello" }]);
  rerender([turn]);
  expect(result.current.sending).toStrictEqual([]);
  rerender([]);
  expect(result.current.sending).toStrictEqual([]);
});

test("a press the door refuses is held no longer", async () => {
  doorAnswering([400]);
  const { result } = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper },
  );
  let sent: Promise<unknown> = Promise.resolve();
  act(() => {
    sent = result.current.composer.onSend("hello", []);
  });
  expect(result.current.sending).toHaveLength(1);
  await act(async () => {
    expect(await sent).toBe("Kept");
  });
  expect(result.current.sending).toStrictEqual([]);
});

test("a send the hosted grant refuses keeps the text and stops the composer taking any more", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(answer({ error: { code: "HostedRunsNotGranted" } }, 403)),
  );
  const { result } = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper },
  );
  let sent: unknown;
  await act(async () => {
    sent = await result.current.composer.onSend("hello", []);
  });
  expect(sent).toBe("Kept");
  expect(result.current.composer.takes).toBe(false);
  expect(result.current.composer.holds).toBe(true);
});

/** A grant whose read says it is not given, the door posted to by nobody. */
function grantWithheld(): string[] {
  const posted: string[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (init.method === "POST") posted.push(url);
    return Promise.resolve(
      url.endsWith("/hosted-runs")
        ? answer({ granted: false })
        : answer({ error: { code: "Invalid" } }, 400),
    );
  });
  return posted;
}

test("a grant read as not given holds the composer before anything is typed", async () => {
  const posted = grantWithheld();
  const { result } = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    { wrapper },
  );
  expect(
    result.current.composer.takes,
    "the box took text before the read",
  ).toBe(true);
  await settled();
  expect(result.current.composer.takes).toBe(false);
  expect(result.current.composer.holds).toBe(true);
  expect(posted).toStrictEqual([]);
});

/** A closed thread is closed whatever the grant: the box says `Closed`, not
 * that a grant would open it. */
test("a thread that takes no messages is not held for the grant", async () => {
  grantWithheld();
  const { result } = renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: false,
      }),
    { wrapper },
  );
  await settled();
  expect(result.current.composer.takes).toBe(false);
  expect(result.current.composer.holds).toBe(false);
});
