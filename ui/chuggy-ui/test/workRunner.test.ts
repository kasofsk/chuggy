/**
 * Whether a project's work has a runner to go to, over every answer its two
 * reads can give: no runner is said only where both say so, a half that
 * settles the question alone is not waited on, and a read that failed decides
 * nothing.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import { workRunner } from "../app/core/workRunner.ts";
import type { WorkRunnerRead } from "../app/core/workRunner.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  executionPlacementBody,
  workRunnerAnswered,
  workRunnerFailed,
  workRunnerRetried,
  workRunnerUnread,
} from "./workRunnerFixture.ts";

const toRunners = workRunnerAnswered(executionPlacementBody("Pool"));
const hosted = workRunnerAnswered(executionPlacementBody("InCluster"));
const unregistered = workRunnerAnswered(
  sessionPlacementBody({ project: "Unregistered" }),
);
const offline = workRunnerAnswered(
  sessionPlacementBody({ project: "Offline" }),
);
const live = workRunnerAnswered(sessionPlacementBody({ project: "Live" }));

type Placement = WorkRunnerRead<ExecutionPlacementResponse>;
type Runners = WorkRunnerRead<SessionPlacementResponse>;

test("work that goes to runners in a project with none registered has no runner", () => {
  expect(workRunner(toRunners, unregistered)).toBe("NoRunner");
});

/** The reader's own runners are not the project's: work goes to any of the
 * project's, so one this reader registered none of is still one. */
test("it is the project's runners that are read, and not the reader's own", () => {
  expect(
    workRunner(
      toRunners,
      workRunnerAnswered(
        sessionPlacementBody({ mine: "Live", project: "Unregistered" }),
      ),
    ),
  ).toBe("NoRunner");
  expect(
    workRunner(
      toRunners,
      workRunnerAnswered(
        sessionPlacementBody({ mine: "Unregistered", project: "Live" }),
      ),
    ),
  ).toBe("Clear");
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
  expect(workRunner(hostedWork, unregistered)).toBe("Clear");
  expect(workRunner(hostedEvaluation, unregistered)).toBe("NoRunner");
});

const routes: readonly (readonly [string, Placement])[] = [
  ["goes to runners", toRunners],
  ["is hosted", hosted],
  ["is not read yet", workRunnerUnread],
];

test.each(routes)(
  "a runner registered clears work that %s, live or not",
  (_route, placement) => {
    expect(workRunner(placement, offline)).toBe("Clear");
    expect(workRunner(placement, live)).toBe("Clear");
  },
);

const standings: readonly (readonly [string, Runners])[] = [
  ["none registered", unregistered],
  ["one offline", offline],
  ["one live", live],
  ["its runners not read yet", workRunnerUnread],
];

test.each(standings)(
  "hosted work waits on no runner, in a project with %s",
  (_standing, runners) => {
    expect(workRunner(hosted, runners)).toBe("Clear");
  },
);

const held: readonly (readonly [string, Placement, Runners])[] = [
  ["the runners are", toRunners, workRunnerUnread],
  ["the route is", workRunnerUnread, unregistered],
  ["both are", workRunnerUnread, workRunnerUnread],
];

test.each(held)(
  "the question is held while %s unread and could still say no runner",
  (_unread, placement, runners) => {
    expect(workRunner(placement, runners)).toBe("Held");
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
    expect(workRunner(toRunners, failed)).toBe("Clear");
    expect(workRunner(failed, unregistered)).toBe("Clear");
    expect(workRunner(workRunnerUnread, failed)).toBe("Clear");
    expect(workRunner(failed, workRunnerUnread)).toBe("Clear");
  },
);
