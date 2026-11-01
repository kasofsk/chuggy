/**
 * The thread sends' slice with no tree: a press is a thunk over the store's
 * own ports, so what it ends as is in the record whether or not any box drew
 * it.
 */

import { afterEach, expect, test, vi } from "vitest";

import { threadBacklogMax } from "../../../src/contract/http.ts";
import { chatPaneReadAt } from "../app/browser/shell/chatPanes.ts";
import {
  threadSendAt,
  threadSendKeptAttached,
  threadSendPressed,
  threadStopPressed,
} from "../app/browser/thread/threadSends.ts";
import type { ConversationAttachment } from "../app/core/conversationAttachments.ts";
import { threadHomeOf } from "../app/core/threadHome.ts";
import {
  threadSendRecordEmpty,
  threadSendRecordName,
} from "../app/core/threads.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";
import { answer } from "./screenHarness.tsx";
import { threadEntry, threadPartition } from "./threadFixture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every post, by its path and body: each open answers `thread-1`, each
 * upload an artifact, and each message the next status `statuses` names. */
function doorStubbed(statuses: number[]): (readonly [string, unknown])[] {
  const posted: (readonly [string, unknown])[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : {};
    posted.push([new URL(url, "http://console").pathname, body]);
    if (url.endsWith("/artifacts"))
      return Promise.resolve(
        answer(
          { artifact: `artifact-${String(posted.length)}`, digest: "d" },
          201,
        ),
      );
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

/** One image, its bytes named by `at`. */
function shot(at: number): readonly ConversationAttachment[] {
  return [{ mediaType: "image/png", content: new Uint8Array([at]) }];
}

test("refused presses carrying images hold them for no more turns than the mailbox takes, a kept message's past that, and a retry past it draws a turn of its own", async () => {
  const posted = doorStubbed(Array<number>(threadBacklogMax + 3).fill(400));
  const store = consoleStoreBare();
  const pressedOn = (
    session: string,
    attached: readonly ConversationAttachment[],
    drawn: boolean,
  ) =>
    store.dispatch(
      threadSendPressed({
        home,
        session,
        text: "hello",
        attached,
        ...(drawn ? { drawn: () => true } : {}),
      }),
    );
  const record = (session: string) =>
    threadSendAt(store.getState(), threadSendRecordName(home, session));
  const imagesOf = (turns: readonly string[]) =>
    store.dispatch(threadSendKeptAttached(turns));
  const sessions = Array.from(
    { length: threadBacklogMax + 1 },
    (_, at) => `thread-${String(at)}`,
  );
  for (const [at, session] of sessions.entries())
    await pressedOn(session, shot(at), true);
  const holding = sessions.filter(
    (session) => imagesOf([record(session).held?.turn ?? ""]).length > 0,
  );
  expect(holding).toStrictEqual(sessions.slice(0, threadBacklogMax));

  const kept = shot(threadBacklogMax + 1);
  await pressedOn("thread-kept", kept, false);
  expect(imagesOf(record("thread-kept").kept?.turns ?? [])).toStrictEqual(kept);

  const past = sessions[threadBacklogMax] ?? "";
  await pressedOn(past, shot(threadBacklogMax), true);
  const turns = posted
    .filter(([path]) => path.endsWith(`/${past}/messages`))
    .map(([, body]) => (body as { turn: string }).turn);
  expect(turns).toHaveLength(2);
  expect(turns[1], "a retry past the bound").not.toBe(turns[0]);
});

test("the pane's start ending empties a project's first record, a stop answered after that writes nothing, and a project with none is not written", async () => {
  doorStubbed([400, 400]);
  const store = consoleStoreBare();
  const untouched = store.getState().threadSends;
  store.dispatch(chatPaneReadAt(threadPartition));
  expect(store.getState().threadSends).toBe(untouched);

  await store.dispatch(
    threadSendPressed({
      home,
      session: undefined,
      text: "hello",
      attached: [],
      drawn: () => true,
    }),
  );
  expect(threadSendAt(store.getState(), first).opened).toBe("thread-1");
  const stopped = store.dispatch(
    threadStopPressed({ home, session: undefined, turn: "turn-1" }),
  );
  store.dispatch(chatPaneReadAt(threadPartition));
  expect(threadSendAt(store.getState(), first)).toBe(threadSendRecordEmpty);
  await stopped;
  expect(threadSendAt(store.getState(), first)).toBe(threadSendRecordEmpty);
});
