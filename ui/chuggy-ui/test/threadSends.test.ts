/**
 * The thread sends' slice with no tree: a press is a thunk over the store's
 * own ports, so what it ends as is in the record whether or not any box drew
 * it.
 */

import { afterEach, expect, test, vi } from "vitest";

import {
  threadSendAt,
  threadSendPressed,
} from "../app/browser/thread/threadSends.ts";
import { threadHomeOf } from "../app/core/threadHome.ts";
import { threadSendRecordName } from "../app/core/threads.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";
import { answer } from "./screenHarness.tsx";
import { threadEntry, threadPartition } from "./threadFixture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every post, by its path and body: each open answers `thread-1`, and each
 * message the next status `statuses` names. */
function doorStubbed(statuses: number[]): (readonly [string, unknown])[] {
  const posted: (readonly [string, unknown])[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : {};
    posted.push([new URL(url, "http://console").pathname, body]);
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

const home = threadHomeOf(threadPartition);
const first = threadSendRecordName(home, undefined);

test("a press with no box opens a thread and sends to it", async () => {
  const posted = doorStubbed([]);
  const store = consoleStoreBare();
  const ended = await store.dispatch(
    threadSendPressed({
      home,
      session: undefined,
      text: "hello",
      attached: [],
    }),
  );
  expect(ended).toStrictEqual({ back: false, started: "thread-1" });
  expect(
    posted.map(([path]) => path.split("/").slice(-2).join("/")),
  ).toStrictEqual(["atlas/threads", "thread-1/messages"]);
  const record = threadSendAt(store.getState(), first);
  expect(record.send).toStrictEqual({ send: "Sent", ordinal: 1 });
  expect(record.openKey, "the key is spent").toBeUndefined();
  expect(record.kept).toBeUndefined();
});

test("a refused press with no box leaves its message and its key in the record, and the next press sends to the thread it opened", async () => {
  const posted = doorStubbed([400]);
  const store = consoleStoreBare();
  const ended = await store.dispatch(
    threadSendPressed({
      home,
      session: undefined,
      text: "hello",
      attached: [],
    }),
  );
  expect(ended).toStrictEqual({ back: false, started: undefined });
  const record = threadSendAt(store.getState(), first);
  expect(record.kept).toStrictEqual({
    text: "hello",
    turns: [record.held?.turn],
  });
  expect(record.openKey).toBe((posted[0]?.[1] as { key: string }).key);
  expect(record.opened).toBe("thread-1");

  await store.dispatch(
    threadSendPressed({
      home,
      session: undefined,
      text: "hello",
      attached: [],
    }),
  );
  expect(posted.filter(([path]) => path.endsWith("/threads"))).toHaveLength(1);
  const [one, two] = posted.filter(([path]) => path.endsWith("/messages"));
  expect(two?.[1], "the text keeps its turn").toStrictEqual(one?.[1]);
});
