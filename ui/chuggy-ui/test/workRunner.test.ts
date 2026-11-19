/**
 * Whether a project's work has a runner to go to, over every answer its reads
 * can give: hosted work and work not known to be the reader's are clear, the
 * reader's own work has no runner only where their personal runners serve the
 * project none, a read that settles the question alone is not waited on, and a
 * read that failed decides nothing.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  PersonalRunnerResponse,
} from "../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../src/contract/rosters.ts";
import {
  workRunner,
  workRunnerPersonal,
  workRunnerPersonalRead,
} from "../app/core/workRunner.ts";
import type { WorkRunnerRead } from "../app/core/workRunner.ts";
import {
  executionPlacementBody,
  workRunnerAnswered,
  workRunnerFailed,
  workRunnerNoPersonal,
  workRunnerRetried,
  workRunnerUnread,
} from "./workRunnerFixture.ts";

type Placement = WorkRunnerRead<ExecutionPlacementResponse>;
type Personal = WorkRunnerRead<SessionRunnerStanding>;

const toRunners: Placement = workRunnerAnswered(executionPlacementBody("Pool"));
const hosted: Placement = workRunnerAnswered(
  executionPlacementBody("InCluster"),
);

function personal(standing: SessionRunnerStanding): Personal {
  return workRunnerAnswered(standing);
}

test("the reader's own work that goes to runners has no runner where they hold none serving the project", () => {
  expect(workRunner(toRunners, workRunnerNoPersonal, "Reader")).toBe(
    "NoRunner",
  );
});

test("the reader's own work is clear on a personal runner of theirs that serves the project, live or not", () => {
  expect(workRunner(toRunners, personal("Live"), "Reader")).toBe("Clear");
  expect(workRunner(toRunners, personal("Offline"), "Reader")).toBe("Clear");
});

/** Another member's runners are not the reader's to read, so whatever came of
 * the reader's own says nothing of that member's work. */
test("work not known to be the reader's is clear whatever their own runners", () => {
  for (const mine of [workRunnerNoPersonal, workRunnerUnread, workRunnerFailed])
    expect(workRunner(toRunners, mine, "Unknown")).toBe("Clear");
  expect(workRunner(workRunnerUnread, workRunnerUnread, "Unknown")).toBe(
    "Clear",
  );
});

test("hosted work waits on no runner, whatever the reader's own", () => {
  for (const mine of [workRunnerNoPersonal, personal("Live"), workRunnerUnread])
    expect(workRunner(hosted, mine, "Reader")).toBe("Clear");
});

/** Evaluation's route is not work's, and a start starts work. */
test("it is where work runs that is read, and not where evaluation does", () => {
  const hostedWork: Placement = workRunnerAnswered({
    ...executionPlacementBody("InCluster"),
    evaluation: { route: "Pool", source: "Default" },
  });
  const hostedEvaluation: Placement = workRunnerAnswered({
    ...executionPlacementBody("Pool"),
    evaluation: { route: "InCluster", source: "Default" },
  });
  expect(workRunner(hostedWork, workRunnerNoPersonal, "Reader")).toBe("Clear");
  expect(workRunner(hostedEvaluation, workRunnerNoPersonal, "Reader")).toBe(
    "NoRunner",
  );
});

test("a registered personal runner clears the reader's work before the route is read", () => {
  expect(workRunner(workRunnerUnread, personal("Live"), "Reader")).toBe(
    "Clear",
  );
});

const held: readonly (readonly [string, Placement, Personal])[] = [
  ["the reader's runners are", toRunners, workRunnerUnread],
  ["the route is", workRunnerUnread, workRunnerNoPersonal],
  ["both are", workRunnerUnread, workRunnerUnread],
];

test.each(held)(
  "the reader's work is held while %s unread and could still say no runner",
  (_unread, placement, mine) => {
    expect(workRunner(placement, mine, "Reader")).toBe("Held");
  },
);

const failures: readonly (readonly [string, WorkRunnerRead<never>])[] = [
  ["failed", workRunnerFailed],
  ["failed and is asked again", workRunnerRetried],
];

/** The other half says no runner as loudly as it can in each case, so what is
 * read is that the failure alone clears it. */
test.each(failures)(
  "a read that %s decides nothing, whichever of the two it is",
  (_failure, failed) => {
    expect(workRunner(toRunners, failed, "Reader")).toBe("Clear");
    expect(workRunner(failed, workRunnerNoPersonal, "Reader")).toBe("Clear");
    expect(workRunner(workRunnerUnread, failed, "Reader")).toBe("Clear");
    expect(workRunner(failed, workRunnerUnread, "Reader")).toBe("Clear");
  },
);

const runnerListed: PersonalRunnerResponse["runners"][number] = {
  id: "runner-1",
  capabilities: ["Platform:Linux:Amd64"],
  registeredAt: "2026-10-09T00:00:00Z",
  live: false,
  executionsLive: false,
  held: [],
  heldTruncated: false,
};

function personalBody(
  live: readonly boolean[],
  projects: readonly string[],
): PersonalRunnerResponse {
  return {
    runners: live.map((each, at) => ({
      ...runnerListed,
      id: `runner-${String(at)}`,
      live: each,
    })),
    projects: projects.map((project) => ({
      project,
      priority: "Normal",
      waiting: 0,
      waitingTruncated: false,
    })),
  };
}

test("the reader's personal runners stand for a project only where they serve it, live where any one is", () => {
  expect(workRunnerPersonal(undefined, "web")).toBe("Unregistered");
  expect(workRunnerPersonal(personalBody([true], ["api"]), "web")).toBe(
    "Unregistered",
  );
  expect(workRunnerPersonal(personalBody([false], ["web"]), "web")).toBe(
    "Offline",
  );
  expect(
    workRunnerPersonal(personalBody([false, true], ["api", "web"]), "web"),
  ).toBe("Live");
});

test("a reader holding no personal runner is answered absent, which reads as none and not as a failure", () => {
  expect(
    workRunnerPersonalRead({ state: { state: "Absent" }, settled: true }, "web")
      .state,
  ).toEqual({ state: "Ready", value: "Unregistered", observedAtMs: undefined });
  expect(
    workRunnerPersonalRead(
      workRunnerAnswered(personalBody([true], ["web"])),
      "web",
    ).state,
  ).toEqual({ state: "Ready", value: "Live", observedAtMs: undefined });
  expect(workRunnerPersonalRead(workRunnerFailed, "web")).toEqual(
    workRunnerFailed,
  );
});
