/**
 * What the Now card says about a running run, over what its transcript pane
 * holds.
 *
 * The quiet failures are a card that leads with an old note, one that shows a
 * call as still out after its result came back or after the run ended, one
 * that counts what the member side said as the agent's notes, and one that
 * states a note count for a run it holds only the tail of.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import type {
  ExecutionResponse,
  RunTranscriptResponse,
} from "../../../src/contract/responses.ts";
import { runNowAttempt, runNowOf } from "../app/core/runNow.ts";
import type { RunNowAttempt } from "../app/core/runNow.ts";
import {
  runTranscriptHeldEmpty,
  runTranscriptMerged,
  runTranscriptRead,
} from "../app/core/runTranscript.ts";
import type { RunTranscriptReading } from "../app/core/runTranscript.ts";

function said(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function called(id: string, name: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input: { path: "a.ts" } }],
    },
  });
}

function answered(id: string): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
  });
}

function recordedAt(batch: number): string {
  return `2026-08-27T00:00:${String(batch).padStart(2, "0")}Z`;
}

/** What a pane reads over batches numbered from `first`, one line list each. */
function reading(
  batches: readonly (readonly string[])[],
  first = 1,
): RunTranscriptReading {
  const page: RunTranscriptResponse = {
    batches: batches.map((lines, at) => ({
      batch: first + at,
      recordedAt: recordedAt(first + at),
      bytes: 1,
      read: "Content" as const,
      content: lines.join("\n"),
    })),
    observedAt: "2026-08-27T00:01:00Z",
    complete: false,
  };
  return runTranscriptRead(
    runTranscriptMerged(runTranscriptHeldEmpty, page, copyTextEn),
    copyTextEn,
  );
}

test("the newest note leads", () => {
  const notes = ["one", "two", "three"];
  const now = runNowOf(reading(notes.map((note) => [said(note)])), true);
  expect(now.note).toEqual({ text: "three", at: recordedAt(3) });
});

test("a note is one line, whatever whitespace the agent wrote it with", () => {
  const now = runNowOf(reading([[said("  first\n\nsecond  ")]]), true);
  expect(now.note?.text).toBe("first second");
});

/** A subagent's prompt is written as user text, and it is not the agent's
 * own account of what it is doing. */
test("what the member side said is not a note", () => {
  const now = runNowOf(
    reading([
      [said("mine")],
      [JSON.stringify({ type: "user", message: { content: "theirs" } })],
    ]),
    true,
  );
  expect(now.note?.text).toBe("mine");
});

test("the call in flight is the newest no result has answered", () => {
  const now = runNowOf(
    reading([[called("t1", "Read")], [called("t2", "Bash")], [answered("t2")]]),
    true,
  );
  expect(now.call).toEqual({
    name: "Read",
    argument: { argument: "Text", text: "a.ts" },
    at: recordedAt(1),
  });
  const all = runNowOf(
    reading([[called("t1", "Read")], [answered("t1")]]),
    true,
  );
  expect(all.call).toBeUndefined();
});

/** A run that ended mid-call is not waiting on anything. */
test("a run no longer live has no call in flight", () => {
  expect(runNowOf(reading([[called("t1", "Read")]]), false).call).toBe(
    undefined,
  );
});

function attempt(number: number, state: RunNowAttempt["state"]): RunNowAttempt {
  return {
    attempt: `a${String(number)}`,
    number,
    generation: 1,
    state,
    openedAt: recordedAt(number),
  };
}

test("the card follows the newest live attempt, and the newest where none is live", () => {
  const execution = (attempts: readonly RunNowAttempt[]): ExecutionResponse =>
    ({ attempts }) as unknown as ExecutionResponse;
  expect(
    runNowAttempt(
      execution([
        attempt(3, "Lost"),
        attempt(2, "Running"),
        attempt(1, "Lost"),
      ]),
    )?.attempt,
  ).toBe("a2");
  expect(
    runNowAttempt(execution([attempt(2, "Lost"), attempt(1, "Reported")]))
      ?.attempt,
  ).toBe("a2");
  expect(runNowAttempt(execution([]))).toBeUndefined();
});
