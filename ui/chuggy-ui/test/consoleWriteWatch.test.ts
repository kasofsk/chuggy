/**
 * The watch of a client's writes: a refusal under a key a screen is showing is
 * that screen's, one under no watched key is kept for the shell, and what is
 * kept is bounded, the oldest let go first.
 */

import { expect, test } from "vitest";

import {
  ConsoleWriteWatch,
  consoleWriteKey,
  consoleWriteUnseenMax,
} from "../app/core/consoleWrite.ts";

const saved = consoleWriteKey("owner-fallback", "acme", "atlas");

test("a refusal under a watched key is not kept, and is once the watch is released", () => {
  const watch = new ConsoleWriteWatch();
  const released = watch.watched(saved);
  watch.refused(saved, "Failed · first");
  expect(watch.unseen).toStrictEqual([]);

  released();
  watch.refused(consoleWriteKey("owner-fallback", "acme", "atlas"), "second");
  expect(watch.unseen.map((unseen) => unseen.sentence)).toStrictEqual([
    "second",
  ]);
});

test("two screens watching one key both have to go before a refusal is kept", () => {
  const watch = new ConsoleWriteWatch();
  const first = watch.watched(saved);
  const second = watch.watched(saved);
  first();
  watch.refused(saved, "still watched");
  expect(watch.unseen).toStrictEqual([]);
  second();
  watch.refused(saved, "unwatched");
  expect(watch.unseen).toHaveLength(1);
});

test("what is kept is bounded, the oldest let go first, and a dismissal takes one away", () => {
  const watch = new ConsoleWriteWatch();
  const sentences = Array.from(
    { length: consoleWriteUnseenMax + 1 },
    (_, index) => `refused ${String(index)}`,
  );
  for (const sentence of sentences) watch.refused(saved, sentence);
  expect(watch.unseen.map((unseen) => unseen.sentence)).toStrictEqual(
    sentences.slice(1),
  );

  const [oldest] = watch.unseen;
  if (oldest === undefined) throw new Error("nothing was kept");
  watch.dismissed(oldest.id);
  expect(watch.unseen.map((unseen) => unseen.sentence)).toStrictEqual(
    sentences.slice(2),
  );
});
