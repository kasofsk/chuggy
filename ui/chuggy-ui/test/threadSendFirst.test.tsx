/**
 * The composer of a reader with no thread: the first press opens one and sends
 * into it, and a press after that one was refused sends into the thread it
 * opened rather than opening another. And what the tenant's hosted grant does
 * to a composer, read before a press or met by one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionProvider } from "../app/browser/session.tsx";
import { useThreadSend } from "../app/browser/thread/threadSend.tsx";
import { answer, holderDouble, settled } from "./screenHarness.tsx";
import { threadEntry, threadPartition } from "./threadFixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Posted {
  readonly url: string;
  readonly body: unknown;
}

/** The door as the case scripts it: every open answers the same thread, and
 * each message is answered by the next status the case names. */
function doorAnswering(messageStatuses: readonly number[]): Posted[] {
  const posted: Posted[] = [];
  const statuses = [...messageStatuses];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    posted.push({
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.endsWith("/threads"))
      return Promise.resolve(
        answer(threadEntry({ session: "thread-1", mine: true }), 201),
      );
    const status = statuses.shift() ?? 202;
    return Promise.resolve(
      status === 202
        ? answer({ turn: "t", ordinal: 1 }, 202)
        : answer({ error: { code: "Invalid" } }, status),
    );
  });
  return posted;
}

function wrapper(props: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
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
    first = await result.current.onSend("hello");
  });
  expect(first).toBe("Kept");
  expect(started).toStrictEqual([]);
  let second: unknown;
  await act(async () => {
    second = await result.current.onSend("hello");
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
    sent = await result.current.onSend("hello");
  });
  expect(sent).toBe("Kept");
  expect(result.current.takes).toBe(false);
  expect(result.current.holds).toBe(true);
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
  expect(result.current.takes, "the box took text before the read").toBe(true);
  await settled();
  expect(result.current.takes).toBe(false);
  expect(result.current.holds).toBe(true);
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
  expect(result.current.takes).toBe(false);
  expect(result.current.holds).toBe(false);
});
