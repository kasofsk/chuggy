/**
 * The watch of a client's writes and the store made over its client: a
 * refusal a screen watching its key draws is that screen's, one no watching
 * screen draws is kept in the store for the shell, and what is kept is
 * bounded, the oldest let go first. The console's cache asks a refusal of the
 * watch once the cache has told its readers what it held before it. A read
 * whose document the schema refused leaves the store saying the console is
 * outdated. No tree is drawn, so nothing here is kept by a screen.
 */

import { QueryObserver, notifyManager } from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";
import { expect, test } from "vitest";

import { consoleOutdatedOf } from "../app/browser/consoleOutdated.ts";
import {
  consoleWriteUnseenLetGo,
  consoleWriteUnseenOf,
} from "../app/browser/consoleWriteUnseen.ts";
import type { ConsoleStore } from "../app/browser/store.ts";
import { ApiOutcomeError } from "../app/core/apiRequest.ts";
import {
  ConsoleWriteRefused,
  consoleQueryClient,
  consoleWriteKey,
  consoleWriteUnseenMax,
  consoleWriteWatchOf,
} from "../app/core/consoleWrite.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";

const saved = consoleWriteKey("owner-fallback", "acme", "atlas");

const drawn = (): boolean => true;

function refusal(sentence: string): ConsoleWriteRefused {
  return new ConsoleWriteRefused(sentence);
}

/** A client and the store made over it, as `main.tsx` makes them. */
function tab(): { readonly client: QueryClient; readonly store: ConsoleStore } {
  const client = consoleQueryClient();
  return { client, store: consoleStoreBare(client) };
}

function unseen(store: ConsoleStore): readonly string[] {
  return consoleWriteUnseenOf(store.getState()).map(
    (refused) => refused.sentence,
  );
}

/** A write under `key` sent through the client's cache and refused as
 * `sentence`, and the cache's notices after it flushed. */
async function refusedThrough(
  client: QueryClient,
  key: readonly unknown[],
  sentence: string,
): Promise<void> {
  const written = client.getMutationCache().build(client, {
    mutationKey: key,
    mutationFn: () => Promise.reject(refusal(sentence)),
  });
  await expect(written.execute(undefined)).rejects.toThrow(sentence);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a refused write no screen draws is kept in the store, bounded with the oldest let go first, and a dismissal takes one away", async () => {
  const { client, store } = tab();
  const sentences = Array.from(
    { length: consoleWriteUnseenMax + 1 },
    (_, index) => `refused ${String(index)}`,
  );
  for (const sentence of sentences)
    await refusedThrough(client, saved, sentence);
  expect(unseen(store)).toStrictEqual(sentences.slice(1));

  const [oldest] = consoleWriteUnseenOf(store.getState());
  if (oldest === undefined) throw new Error("nothing was kept");
  store.dispatch(consoleWriteUnseenLetGo(oldest.id));
  expect(unseen(store)).toStrictEqual(sentences.slice(2));
});

test("a refused write a watching screen draws is not kept in the store", async () => {
  const { client, store } = tab();
  consoleWriteWatchOf(client).watched(saved, drawn);
  await refusedThrough(client, saved, "drawn by the screen");
  expect(unseen(store)).toStrictEqual([]);
});

test("a client with no store keeps no refusal", async () => {
  const client = consoleQueryClient();
  await refusedThrough(client, saved, "heard by nobody");
  const store = consoleStoreBare(client);
  expect(unseen(store)).toStrictEqual([]);
});

test("a read whose document the schema refused leaves the store saying the console is outdated", async () => {
  const { client, store } = tab();
  expect(consoleOutdatedOf(store.getState())).toBe(false);
  await expect(
    client.fetchQuery({
      queryKey: ["unread"],
      queryFn: () =>
        Promise.reject(
          new ApiOutcomeError(
            {
              outcome: "Unreadable",
              reason: "unrecognized key",
              shapeRefused: true,
            },
            "unread",
          ),
        ),
    }),
  ).rejects.toThrow();
  expect(consoleOutdatedOf(store.getState())).toBe(true);
});

test("a read answered with a body that was never JSON leaves the console current", async () => {
  const { client, store } = tab();
  await expect(
    client.fetchQuery({
      queryKey: ["unread"],
      queryFn: () =>
        Promise.reject(
          new ApiOutcomeError(
            { outcome: "Unreadable", reason: "not JSON" },
            "unread",
          ),
        ),
    }),
  ).rejects.toThrow();
  expect(consoleOutdatedOf(store.getState())).toBe(false);
});

test("a refusal under a watched key is not kept, and is once the watch is released", () => {
  const { client, store } = tab();
  const watch = consoleWriteWatchOf(client);
  const released = watch.watched(saved, drawn);
  watch.refused(saved, refusal("Failed · first"), undefined);
  expect(unseen(store)).toStrictEqual([]);

  released();
  watch.refused(
    consoleWriteKey("owner-fallback", "acme", "atlas"),
    refusal("second"),
    undefined,
  );
  expect(unseen(store)).toStrictEqual(["second"]);
});

test("two screens watching one key both have to go before a refusal is kept", () => {
  const { client, store } = tab();
  const watch = consoleWriteWatchOf(client);
  const first = watch.watched(saved, drawn);
  const second = watch.watched(saved, drawn);
  first();
  watch.refused(saved, refusal("still watched"), undefined);
  expect(unseen(store)).toStrictEqual([]);
  second();
  watch.refused(saved, refusal("unwatched"), undefined);
  expect(unseen(store)).toHaveLength(1);
});

test("a refusal a watching screen does not draw is kept, asked of the variables it was sent with", () => {
  const { client, store } = tab();
  const watch = consoleWriteWatchOf(client);
  const asked: unknown[] = [];
  watch.watched(saved, (_, variables) => {
    asked.push(variables);
    return variables === "drawn here";
  });
  watch.refused(saved, refusal("drawn by the screen"), "drawn here");
  expect(unseen(store)).toStrictEqual([]);
  watch.refused(saved, refusal("drawn nowhere"), "names left behind");
  expect(unseen(store)).toStrictEqual(["drawn nowhere"]);
  expect(asked).toStrictEqual(["drawn here", "names left behind"]);
});

test("the console's cache asks a refusal of the watch once its readers have been told what the write changed before it", async () => {
  const client = consoleQueryClient();
  const read = ["owner-fallback", "read"];
  client.setQueryData(read, "before");
  const told: unknown[] = [];
  const observer = new QueryObserver(client, {
    queryKey: read,
    queryFn: () => "unread",
    enabled: false,
  });
  const unsubscribed = observer.subscribe(
    notifyManager.batchCalls((result) => {
      told.push(result.data);
    }),
  );
  const asked: unknown[] = [];
  consoleWriteWatchOf(client).watched(saved, () => {
    asked.push(told.at(-1));
    return true;
  });

  const written = client.getMutationCache().build(client, {
    mutationKey: saved,
    mutationFn: () => {
      client.setQueryData(read, "after");
      return Promise.reject(refusal("refused"));
    },
  });
  await expect(written.execute(undefined)).rejects.toThrow("refused");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(asked).toStrictEqual(["after"]);
  unsubscribed();
});
