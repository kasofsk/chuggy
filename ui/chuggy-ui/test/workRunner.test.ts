/**
 * Whether a project's work has a runner to go to, over every answer its reads
 * can give: no runner is said only where every one says so, a read that
 * settles the question alone is not waited on, and a read that failed decides
 * nothing.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  ProjectOwnerFallbackResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../src/contract/rosters.ts";
import { workRunner } from "../app/core/workRunner.ts";
import type {
  WorkRunner,
  WorkRunnerOwner,
  WorkRunnerRead,
} from "../app/core/workRunner.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  executionPlacementBody,
  workRunnerAnswered,
  workRunnerFailed,
  workRunnerRetried,
  workRunnerUnnamed,
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
type Fallback = WorkRunnerRead<ProjectOwnerFallbackResponse>;

const strict: Fallback = workRunnerAnswered({
  fallback: "Strict",
  administers: false,
});
const preferred: Fallback = workRunnerAnswered({
  fallback: "Preferred",
  administers: false,
});

/** A project that names no fallback, for work the reader starts. */
function decided(placement: Placement, runners: Runners): WorkRunner {
  return workRunner(placement, runners, workRunnerUnnamed, "Reader");
}

function noPoolMine(mine: SessionRunnerStanding): Runners {
  return workRunnerAnswered(
    sessionPlacementBody({ mine, project: "Unregistered" }),
  );
}

const owners: readonly WorkRunnerOwner[] = ["Reader", "Unknown"];

test.each(owners)(
  "a project naming no fallback reads no owner's runner, for work of %s",
  (owner) => {
    expect(
      workRunner(toRunners, noPoolMine("Live"), workRunnerUnnamed, owner),
    ).toBe("NoRunner");
  },
);

const named: readonly (readonly [string, Fallback])[] = [
  ["Strict", strict],
  ["Preferred", preferred],
];

/** The owner's runner takes the work a named fallback routes to it, so the
 * reader's own registered runner clears their work as a pool's does. */
test.each(named)(
  "a project naming %s with no pool clears the reader's work on their own runner, live or not",
  (_named, fallback) => {
    expect(workRunner(toRunners, noPoolMine("Live"), fallback, "Reader")).toBe(
      "Clear",
    );
    expect(
      workRunner(toRunners, noPoolMine("Offline"), fallback, "Reader"),
    ).toBe("Clear");
  },
);

/** With no pool there is nothing for Preferred to fall back to, so the
 * reader's work has no runner whichever is named. */
test.each(named)(
  "a project naming %s with no pool has no runner for a reader with none of their own",
  (_named, fallback) => {
    expect(
      workRunner(toRunners, noPoolMine("Unregistered"), fallback, "Reader"),
    ).toBe("NoRunner");
  },
);

/** A ticket's owner may not be its reader, and their runner is not read, so
 * a named fallback is taken as a runner registered. */
test.each(named)(
  "a project naming %s with no pool clears an owner's work whatever the reader's own runner",
  (_named, fallback) => {
    expect(
      workRunner(toRunners, noPoolMine("Unregistered"), fallback, "Unknown"),
    ).toBe("Clear");
  },
);

test("the question is held while the fallback is unread and could still say no runner", () => {
  expect(workRunner(toRunners, unregistered, workRunnerUnread, "Unknown")).toBe(
    "Held",
  );
  expect(workRunner(toRunners, live, workRunnerUnread, "Unknown")).toBe(
    "Clear",
  );
  expect(workRunner(toRunners, unregistered, workRunnerFailed, "Reader")).toBe(
    "Clear",
  );
});

test("work that goes to runners in a project with none registered has no runner", () => {
  expect(decided(toRunners, unregistered)).toBe("NoRunner");
});

/** The reader's own runners are not the project's: work goes to any of the
 * project's, so one this reader registered none of is still one. */
test("it is the project's runners that are read, and not the reader's own", () => {
  expect(
    decided(
      toRunners,
      workRunnerAnswered(
        sessionPlacementBody({ mine: "Live", project: "Unregistered" }),
      ),
    ),
  ).toBe("NoRunner");
  expect(
    decided(
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
  expect(decided(hostedWork, unregistered)).toBe("Clear");
  expect(decided(hostedEvaluation, unregistered)).toBe("NoRunner");
});

const routes: readonly (readonly [string, Placement])[] = [
  ["goes to runners", toRunners],
  ["is hosted", hosted],
  ["is not read yet", workRunnerUnread],
];

test.each(routes)(
  "a runner registered clears work that %s, live or not",
  (_route, placement) => {
    expect(decided(placement, offline)).toBe("Clear");
    expect(decided(placement, live)).toBe("Clear");
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
    expect(decided(hosted, runners)).toBe("Clear");
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
    expect(decided(placement, runners)).toBe("Held");
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
    expect(decided(toRunners, failed)).toBe("Clear");
    expect(decided(failed, unregistered)).toBe("Clear");
    expect(decided(workRunnerUnread, failed)).toBe("Clear");
    expect(decided(failed, workRunnerUnread)).toBe("Clear");
  },
);
