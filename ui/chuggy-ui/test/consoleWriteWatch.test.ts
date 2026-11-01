/**
 * The watch of a client's writes: a refusal a screen watching its key draws is
 * that screen's, one no watching screen draws is kept for the shell, and what
 * is kept is bounded, the oldest let go first.
 */

import { expect, test } from "vitest";

import {
  ConsoleWriteRefused,
  ConsoleWriteWatch,
  consoleWriteKey,
  consoleWriteUnseenMax,
} from "../app/core/consoleWrite.ts";

const saved = consoleWriteKey("owner-fallback", "acme", "atlas");

const drawn = (): boolean => true;

function refusal(sentence: string): ConsoleWriteRefused {
  return new ConsoleWriteRefused(sentence);
}

test("a refusal under a watched key is not kept, and is once the watch is released", () => {
  const watch = new ConsoleWriteWatch();
  const released = watch.watched(saved, drawn);
  watch.refused(saved, refusal("Failed · first"), undefined);
  expect(watch.unseen).toStrictEqual([]);

  released();
  watch.refused(
    consoleWriteKey("owner-fallback", "acme", "atlas"),
    refusal("second"),
    undefined,
  );
  expect(watch.unseen.map((unseen) => unseen.sentence)).toStrictEqual([
    "second",
  ]);
});

test("two screens watching one key both have to go before a refusal is kept", () => {
  const watch = new ConsoleWriteWatch();
  const first = watch.watched(saved, drawn);
  const second = watch.watched(saved, drawn);
  first();
  watch.refused(saved, refusal("still watched"), undefined);
  expect(watch.unseen).toStrictEqual([]);
  second();
  watch.refused(saved, refusal("unwatched"), undefined);
  expect(watch.unseen).toHaveLength(1);
});

test("a refusal a watching screen does not draw is kept, asked of the variables it was sent with", () => {
  const watch = new ConsoleWriteWatch();
  const asked: unknown[] = [];
  watch.watched(saved, (_, variables) => {
    asked.push(variables);
    return variables === "drawn here";
  });
  watch.refused(saved, refusal("drawn by the screen"), "drawn here");
  expect(watch.unseen).toStrictEqual([]);
  watch.refused(saved, refusal("drawn nowhere"), "names left behind");
  expect(watch.unseen.map((unseen) => unseen.sentence)).toStrictEqual([
    "drawn nowhere",
  ]);
  expect(asked).toStrictEqual(["drawn here", "names left behind"]);
});

test("what is kept is bounded, the oldest let go first, and a dismissal takes one away", () => {
  const watch = new ConsoleWriteWatch();
  const sentences = Array.from(
    { length: consoleWriteUnseenMax + 1 },
    (_, index) => `refused ${String(index)}`,
  );
  for (const sentence of sentences)
    watch.refused(saved, refusal(sentence), undefined);
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
