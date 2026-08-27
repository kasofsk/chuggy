/**
 * Which batches a transcript pane still needs, what it does with the ones that
 * arrive, and what each recorded line is as a step.
 *
 * The quiet failures are a pane that re-reads from the first batch every time
 * the high-water mark moves, a pane that calls a run complete because it has
 * caught up rather than because the attempt ended, and a parser that throws on
 * a line the agent runtime has only just started writing.
 */

import { expect, test } from "vitest";

import type { RunTranscriptResponse } from "../../../src/contract/responses.ts";
import type { RunTranscriptHeld } from "../app/core/runTranscript.ts";
import {
  runTranscriptBatchesHeldMax,
  runTranscriptCoverageSentence,
  runTranscriptElisionSentence,
  runTranscriptFreshnessSentence,
  runTranscriptHeldEmpty,
  runTranscriptHighestBatch,
  runTranscriptMerged,
  runTranscriptNextAfter,
  runTranscriptRead,
  runTranscriptStep,
  runTranscriptStepsMax,
} from "../app/core/runTranscript.ts";

function page(
  batches: readonly number[],
  over: Partial<RunTranscriptResponse> = {},
): RunTranscriptResponse {
  return {
    batches: batches.map((batch) => ({
      batch,
      recordedAt: "2026-08-27T00:00:00Z",
      bytes: 1,
      read: "Content" as const,
      content: `{"type":"system","batch":${String(batch)}}`,
    })),
    observedAt: "2026-08-27T00:00:00Z",
    complete: false,
    ...over,
  };
}

test("a pane holding nothing asks from the beginning", () => {
  expect(runTranscriptHighestBatch(runTranscriptHeldEmpty)).toBe(0);
  expect(runTranscriptNextAfter(runTranscriptHeldEmpty, 3)).toBe(0);
});

/** Asking after zero again is how a pane reads every batch a second time. */
test("a pane asks after the highest batch it holds and no earlier", () => {
  const held = runTranscriptMerged(runTranscriptHeldEmpty, page([1, 2, 3]));
  expect(runTranscriptNextAfter(held, 5)).toBe(3);
});

test("a pane holding everything the run has written asks for nothing", () => {
  const held = runTranscriptMerged(runTranscriptHeldEmpty, page([1, 2]));
  expect(runTranscriptNextAfter(held, 2)).toBeUndefined();
  expect(runTranscriptNextAfter(held, 1)).toBeUndefined();
});

test("batches arrive in order, each number once, whatever order they came in", () => {
  const held = runTranscriptMerged(
    runTranscriptMerged(runTranscriptHeldEmpty, page([2, 1])),
    page([2, 3]),
  );
  expect(held.batches.map((batch) => batch.batch)).toEqual([1, 2, 3]);
});

function heldPast(batches: number): RunTranscriptHeld {
  return Array.from({ length: batches }, (_unused, at) => at + 1).reduce(
    (previous, batch) => runTranscriptMerged(previous, page([batch])),
    runTranscriptHeldEmpty,
  );
}

/**
 * Which end the cap drops from is the whole of it: with the newest dropped the
 * highest batch never rises, so every high-water rise re-reads the same cursor
 * and a live pane reads forever while showing nothing new.
 */
test("the batches kept past the cap are the newest, and the oldest are the ones that left", () => {
  const held = heldPast(runTranscriptBatchesHeldMax + 2);
  const newest = Array.from(
    { length: runTranscriptBatchesHeldMax },
    (_unused, at) => at + 3,
  );
  expect(held.batches.map((batch) => batch.batch)).toEqual(newest);
  expect(held.batchesDropped).toBe(2);
  expect(
    runTranscriptCoverageSentence(held, runTranscriptRead(held)),
  ).toContain("2 earlier batches are no longer held");
});

test("a pane already at its cap still advances when the high-water mark rises", () => {
  const held = heldPast(runTranscriptBatchesHeldMax + 2);
  const highest = runTranscriptBatchesHeldMax + 2;
  expect(runTranscriptHighestBatch(held)).toBe(highest);
  expect(runTranscriptNextAfter(held, highest + 1)).toBe(highest);
  const advanced = runTranscriptMerged(held, page([highest + 1]));
  expect(runTranscriptHighestBatch(advanced)).toBe(highest + 1);
  expect(runTranscriptNextAfter(advanced, highest + 1)).toBeUndefined();
});

/**
 * A live run that is momentarily caught up has not ended, and the age drawn is
 * the newest batch the server holds and not the instant this tab rendered:
 * decision 9 makes that sentence the whole substitute for a follow control, so
 * a clock reading its own `now` would always say the pane was current.
 */
test("complete is what the read said, not whether the pane has caught up", () => {
  const caught = runTranscriptMerged(runTranscriptHeldEmpty, page([1]));
  const observedAtMs = Date.parse(caught.observedAt ?? "");
  expect(runTranscriptFreshnessSentence(caught, observedAtMs + 90_000)).toBe(
    "as of 1m ago",
  );
  expect(runTranscriptFreshnessSentence(caught, observedAtMs + 3_000)).toBe(
    "as of 3s ago",
  );
  const ended = runTranscriptMerged(
    runTranscriptHeldEmpty,
    page([1], { complete: true }),
  );
  expect(runTranscriptFreshnessSentence(ended, 0)).toBe("complete");
});

test("a pane that has read nothing says so rather than dating a batch", () => {
  expect(runTranscriptFreshnessSentence(runTranscriptHeldEmpty, 0)).toBe(
    "not read yet",
  );
});

test("an assistant line is its text and the tools it called", () => {
  const step = runTranscriptStep(
    1,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "reading the file" },
          { type: "tool_use", name: "Read" },
          { type: "tool_use", name: "Bash" },
        ],
      },
    }),
  );
  expect(step).toMatchObject({
    step: "Assistant",
    type: "assistant",
    text: "reading the file",
    tools: ["Read", "Bash"],
  });
});

test("a user line says how many tool results it carried", () => {
  const step = runTranscriptStep(
    1,
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    }),
  );
  expect(step).toMatchObject({ step: "User", toolResults: 1 });
});

test("an elided payload is named with the bytes it stood for", () => {
  const step = runTranscriptStep(
    1,
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            content: { chuggy_truncated: { bytes: 32_768, digest: "d" } },
          },
        ],
      },
    }),
  );
  expect(step).toMatchObject({ step: "User", elided: [32_768] });
  expect(runTranscriptElisionSentence(32_768)).toBe(
    "payload elided (32,768 bytes)",
  );
});

test("the run's own truncation lines are drawn as what they say", () => {
  expect(
    runTranscriptStep(
      1,
      JSON.stringify({ type: "chuggy_transcript_truncated", batches: 4_096 }),
    ),
  ).toMatchObject({
    step: "Capped",
    sentence:
      "the run reached its transcript cap and stopped recording after 4,096 batches",
  });
  expect(
    runTranscriptStep(
      2,
      JSON.stringify({ type: "chuggy_turns_truncated", turns: 1_000 }),
    ),
  ).toMatchObject({ step: "Capped" });
});

test("a line this console cannot read is drawn raw rather than thrown on", () => {
  expect(runTranscriptStep(1, "not json at all")).toEqual({
    step: "Unreadable",
    ordinal: 1,
    line: "not json at all",
  });
  expect(runTranscriptStep(2, JSON.stringify({ noType: true }))).toMatchObject({
    step: "Unreadable",
  });
  expect(runTranscriptStep(3, JSON.stringify([1, 2]))).toMatchObject({
    step: "Unreadable",
  });
});

test("every held batch's lines are read in order and blank lines are not steps", () => {
  const held = runTranscriptMerged(runTranscriptHeldEmpty, {
    ...page([]),
    batches: [
      {
        batch: 1,
        recordedAt: "2026-08-27T00:00:00Z",
        bytes: 1,
        read: "Content",
        content: '{"type":"system"}\n\n{"type":"assistant"}\n',
      },
    ],
  });
  const reading = runTranscriptRead(held);
  expect(reading.steps.map((step) => step.ordinal)).toEqual([1, 2]);
  expect(reading.stepsBefore).toBe(0);
});

test("a batch of more steps than one pane draws keeps the newest", () => {
  const lines = Array.from(
    { length: runTranscriptStepsMax + 3 },
    (_unused, at) => `{"type":"step-${String(at)}"}`,
  ).join("\n");
  const held = runTranscriptMerged(runTranscriptHeldEmpty, {
    ...page([]),
    batches: [
      {
        batch: 1,
        recordedAt: "2026-08-27T00:00:00Z",
        bytes: 1,
        read: "Content",
        content: lines,
      },
    ],
  });
  const reading = runTranscriptRead(held);
  expect(reading.steps).toHaveLength(runTranscriptStepsMax);
  expect(reading.stepsBefore).toBe(3);
  expect(reading.steps.at(-1)).toMatchObject({
    type: `step-${String(runTranscriptStepsMax + 2)}`,
  });
});

/** A batch whose bytes are gone or fail their digest is a hole in the record,
 * and a pane that drew nothing for it would show a transcript that looks whole. */
test("a batch the server has no characters for is a step naming the gap", () => {
  const held = runTranscriptMerged(runTranscriptHeldEmpty, {
    ...page([]),
    batches: [
      {
        batch: 1,
        recordedAt: "2026-08-27T00:00:00Z",
        bytes: 20,
        read: "Content",
        content: '{"type":"system"}',
      },
      {
        batch: 2,
        recordedAt: "2026-08-27T00:00:05Z",
        bytes: 0,
        read: "Missing",
      },
      {
        batch: 3,
        recordedAt: "2026-08-27T00:00:06Z",
        bytes: 9,
        read: "Corrupt",
      },
      {
        batch: 4,
        recordedAt: "2026-08-27T00:00:10Z",
        bytes: 20,
        read: "Content",
        content: '{"type":"assistant"}',
      },
    ],
  });
  const reading = runTranscriptRead(held);
  expect(reading.steps.map((step) => step.step)).toEqual([
    "Event",
    "Unavailable",
    "Unavailable",
    "Assistant",
  ]);
  expect(reading.steps[1]).toMatchObject({
    batch: 2,
    read: "Missing",
    sentence: "batch 2: bytes unavailable",
  });
  expect(reading.steps[2]).toMatchObject({
    batch: 3,
    read: "Corrupt",
    sentence: "batch 3: bytes corrupt",
  });
});

/** A marked batch occupies its number, so the cursor must pass it rather than
 * ask for it again forever. */
test("a batch with no characters is still held, and the cursor passes it", () => {
  const held = runTranscriptMerged(runTranscriptHeldEmpty, {
    ...page([]),
    batches: [
      {
        batch: 1,
        recordedAt: "2026-08-27T00:00:00Z",
        bytes: 0,
        read: "Missing",
      },
      {
        batch: 2,
        recordedAt: "2026-08-27T00:00:05Z",
        bytes: 9,
        read: "Corrupt",
      },
    ],
  });
  expect(held.batches.map((batch) => batch.batch)).toEqual([1, 2]);
  expect(runTranscriptHighestBatch(held)).toBe(2);
  expect(runTranscriptNextAfter(held, 2)).toBeUndefined();
  expect(runTranscriptNextAfter(held, 3)).toBe(2);
});
