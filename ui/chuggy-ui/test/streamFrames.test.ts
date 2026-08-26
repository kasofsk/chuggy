/**
 * The event-stream decoder, held across every chunk boundary a network can put
 * one on.
 *
 * The frames a server sends are fixed and the split points are walked
 * exhaustively for one split and by a bounded sweep for two, because the defect
 * this exists for is a frame that decodes correctly only when a chunk happens
 * to end on a terminator.
 */

import { expect, test } from "vitest";

import {
  createStreamDecoder,
  streamFrameBytesMax,
} from "../app/core/streamFrames.ts";
import type { StreamFrame } from "../app/core/streamFrames.ts";

const wire = [
  'event: ready\ndata: {"version":1}\n\n',
  'event: Ticket\nid: 7\ndata: {"version":1,"resource":"3"}\n\n',
  ": a comment nobody reads\r\n",
  'event: source\r\ndata: {"version":1,"state":"live"}\r\n\r\n',
].join("");

const encoder = new TextEncoder();

function decoded(splits: readonly number[]): readonly StreamFrame[] {
  const decoder = createStreamDecoder();
  const frames: StreamFrame[] = [];
  const points = [0, ...splits, wire.length];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] ?? 0;
    const to = points[index] ?? wire.length;
    frames.push(...decoder.push(encoder.encode(wire.slice(from, to))));
  }
  return frames;
}

const whole = decoded([]);

test("a whole chunk yields every frame the server sent", () => {
  expect(whole.map((frame) => frame.event)).toEqual([
    "ready",
    "Ticket",
    "source",
  ]);
  expect(whole[1]?.id).toBe("7");
  expect(whole[2]?.data).toBe('{"version":1,"state":"live"}');
});

test("every single split point yields exactly the same frames", () => {
  for (let at = 1; at < wire.length; at += 1)
    expect(decoded([at])).toEqual(whole);
});

test("a bounded sweep of two split points yields the same frames", () => {
  for (let first = 1; first < wire.length; first += 3)
    for (let second = first + 1; second < wire.length; second += 7)
      expect(decoded([first, second])).toEqual(whole);
});

test("data lines in one frame are joined as the format says", () => {
  const decoder = createStreamDecoder();
  const frames = decoder.push(encoder.encode("data: one\ndata: two\n\n"));
  expect(frames[0]?.data).toBe("one\ntwo");
});

test("a frame that never terminates is refused rather than buffered", () => {
  const decoder = createStreamDecoder();
  expect(() =>
    decoder.push(encoder.encode("data: ".padEnd(streamFrameBytesMax + 2, "x"))),
  ).toThrow(RangeError);
});
