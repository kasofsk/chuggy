import { expect, test } from "vitest";

import type {
  ExecutionResponse,
  OutputContentResponse,
} from "../../../src/contract/responses.ts";
import { artifactPreviewJson } from "../app/core/artifactPreview.ts";
import { runReasonCharsMax } from "../app/core/runReason.ts";
import {
  runResultCommandsOf,
  runResultLineOf,
  runResultOpenedOf,
  runResultOpenedSettled,
} from "../app/core/runResult.ts";
import type { RunResultOpened } from "../app/core/runResult.ts";
import { runAttempt, runSummary } from "./runPageFixture.tsx";
import {
  runResultCheckOutput,
  runResultCheckReport,
  runResultChecks,
  runResultContent,
  runResultFailed,
  runResultReviewReport,
  runResultWorkSummary,
} from "./runResultFixture.ts";

function executionOf(
  result: Record<string, unknown> | undefined,
  over: Record<string, unknown> = {},
  attempts: readonly Record<string, unknown>[] = [runAttempt("a1")],
): ExecutionResponse {
  return {
    ...runSummary(over),
    attempts,
    ...(result === undefined ? {} : { result }),
  } as unknown as ExecutionResponse;
}

test("a row's line is its report's opening, and the report kept whole for its title", () => {
  const line = runResultLineOf(
    executionOf(runResultFailed(runResultReviewReport)),
  );
  expect(Array.from(line?.line ?? "")).toHaveLength(runReasonCharsMax);
  expect(line?.line.endsWith("…")).toBe(true);
  expect(line?.full).toBe(runResultReviewReport);
});

test("a row whose worker left a reason has no report line, and one without a report has none", () => {
  const lost = runAttempt("a1", { state: "Lost", error: { bytes: 9 } });
  expect(
    runResultLineOf(
      executionOf(runResultFailed(runResultCheckReport), {}, [lost]),
    ),
  ).toBeUndefined();
  expect(runResultLineOf(executionOf(runResultFailed(undefined)))).toBe(
    undefined,
  );
  expect(runResultOpenedOf(executionOf(runResultFailed(undefined)))).toBe(
    undefined,
  );
});

test("an agent's result opens its summary output where it lists one, and its report otherwise", () => {
  expect(
    runResultOpenedOf(
      executionOf(
        runResultFailed(runResultReviewReport, [runResultWorkSummary]),
        { carrier: "Agent" },
      ),
    ),
  ).toEqual({ opened: "Report", report: runResultReviewReport, summary: 1 });
  expect(
    runResultOpenedOf(executionOf(runResultFailed(runResultReviewReport))),
  ).toEqual({
    opened: "Report",
    report: runResultReviewReport,
    summary: undefined,
  });
});

test("a command stage opens its commands only where its result lists them, and an absent carrier is an agent's", () => {
  const listed = runResultFailed(runResultCheckReport, [runResultCheckOutput]);
  expect(
    runResultOpenedOf(executionOf(listed, { carrier: "Commands" })),
  ).toEqual({
    opened: "Commands",
    commands: 1,
    report: runResultCheckReport,
  });
  expect(runResultOpenedOf(executionOf(listed))?.opened).toBe("Report");
  expect(
    runResultOpenedOf(
      executionOf(runResultFailed(runResultCheckReport), {
        carrier: "Commands",
      }),
    )?.opened,
  ).toBe("Report");
});

test("a stage's commands become its Report once their read is refused or does not parse", () => {
  const commands: RunResultOpened = {
    opened: "Commands",
    commands: 1,
    report: runResultCheckReport,
  };
  const ready = (content: string) => ({
    state: "Ready" as const,
    value: runResultContent(content) as unknown as OutputContentResponse,
    observedAtMs: undefined,
  });
  const report = {
    opened: "Report",
    report: runResultCheckReport,
    summary: undefined,
  };
  expect(runResultOpenedSettled(commands, undefined)).toBe(commands);
  expect(runResultOpenedSettled(commands, { state: "Pending" })).toBe(commands);
  expect(
    runResultOpenedSettled(
      commands,
      ready(JSON.stringify({ checks: runResultChecks })),
    ),
  ).toBe(commands);
  expect(runResultOpenedSettled(commands, ready("not json"))).toEqual(report);
  expect(
    runResultOpenedSettled(commands, { state: "Absent", reason: "gone" }),
  ).toEqual(report);
  expect(
    runResultOpenedSettled(
      { ...commands, report: undefined },
      { state: "Failed", reason: "refused" },
    ),
  ).toBeUndefined();
});

test("each command ends in one word, and only the failing one is open", () => {
  const commands = runResultCommandsOf(
    JSON.stringify({
      checks: [
        ...runResultChecks,
        {
          command: "sleep 9",
          exitStatus: null,
          signal: "SIGKILL",
          truncated: true,
          output: "",
        },
      ],
    }),
  );
  expect(commands?.map((command) => [command.end, command.open])).toEqual([
    ["Passed", false],
    ["Failed", true],
    ["Killed", true],
  ]);
  expect(commands?.at(-1)?.truncated).toBe(true);
});

test("content that is not the check document has no commands", () => {
  for (const content of [
    "not json",
    "[]",
    '{"checks":[]}',
    '{"checks":[{"command":"true"}]}',
  ])
    expect(runResultCommandsOf(content)).toBeUndefined();
});

test("JSON content is indented, and content that does not parse is drawn as it came", () => {
  expect(artifactPreviewJson('{"a":[1]}')).toBe('{\n  "a": [\n    1\n  ]\n}');
  expect(artifactPreviewJson("{nope")).toBe("{nope");
});
