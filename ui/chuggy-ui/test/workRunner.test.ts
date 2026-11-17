/**
 * Whether a project's work has a runner to go to, over every answer its reads
 * can give: no runner is said only where every one says so, a read that
 * settles the question alone is not waited on, and a read that failed decides
 * nothing. The reader's own runner is a personal runner that serves the
 * project, and never their chat host.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  PersonalRunnerResponse,
  ProjectOwnerFallbackResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../src/contract/rosters.ts";
import {
  workRunner,
  workRunnerPersonal,
  workRunnerPersonalRead,
} from "../app/core/workRunner.ts";
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
  workRunnerNoPersonal,
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
type Personal = WorkRunnerRead<SessionRunnerStanding>;

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
  return workRunner(
    placement,
    runners,
    workRunnerUnnamed,
    workRunnerNoPersonal,
    "Reader",
  );
}

const noPool: Runners = workRunnerAnswered(
  sessionPlacementBody({ mine: "Unregistered", project: "Unregistered" }),
);

function personal(standing: SessionRunnerStanding): Personal {
  return workRunnerAnswered(standing);
}

const owners: readonly WorkRunnerOwner[] = ["Reader", "Unknown"];

test.each(owners)(
  "a project naming no fallback reads no owner's runner, for work of %s",
  (owner) => {
    expect(
      workRunner(toRunners, noPool, workRunnerUnnamed, personal("Live"), owner),
    ).toBe("NoRunner");
  },
);

const named: readonly (readonly [string, Fallback])[] = [
  ["Strict", strict],
  ["Preferred", preferred],
];

/** The owner's runner takes the work a named fallback routes to it, so the
 * reader's own registered personal runner clears their work as a pool's does. */
test.each(named)(
  "a project naming %s with no pool clears the reader's work on their own personal runner, live or not",
  (_named, fallback) => {
    for (const standing of ["Live", "Offline"] as const)
      expect(
        workRunner(toRunners, noPool, fallback, personal(standing), "Reader"),
      ).toBe("Clear");
  },
);

/** A chat host runs the person's threads and takes no work, so it is no
 * owner's runner however it stands. */
test.each(named)(
  "a project naming %s with no pool does not take the reader's chat host as their runner",
  (_named, fallback) => {
    for (const mine of ["Live", "Offline"] as const)
      expect(
        workRunner(
          toRunners,
          workRunnerAnswered(
            sessionPlacementBody({ mine, project: "Unregistered" }),
          ),
          fallback,
          workRunnerNoPersonal,
          "Reader",
        ),
      ).toBe("NoRunner");
  },
);

test("the reader's work is held while their personal runners are unread and a named fallback could still say no runner, and cleared where that read failed", () => {
  expect(
    workRunner(toRunners, noPool, strict, workRunnerUnread, "Reader"),
  ).toBe("Held");
  expect(
    workRunner(toRunners, noPool, strict, workRunnerFailed, "Reader"),
  ).toBe("Clear");
  expect(
    workRunner(
      toRunners,
      noPool,
      workRunnerUnnamed,
      workRunnerUnread,
      "Reader",
    ),
  ).toBe("NoRunner");
});

/** Another owner's runners are not the reader's to read, so the reader's own
 * read failing says nothing of their work. */
test("an owner's work in a project naming no fallback has no runner whatever came of the reader's personal runners", () => {
  expect(
    workRunner(
      toRunners,
      noPool,
      workRunnerUnnamed,
      workRunnerFailed,
      "Unknown",
    ),
  ).toBe("NoRunner");
});

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

/** With no pool there is nothing for Preferred to fall back to, so the
 * reader's work has no runner whichever is named. */
test.each(named)(
  "a project naming %s with no pool has no runner for a reader with none of their own",
  (_named, fallback) => {
    expect(
      workRunner(toRunners, noPool, fallback, workRunnerNoPersonal, "Reader"),
    ).toBe("NoRunner");
  },
);

/** A ticket's owner may not be its reader, and their runner is not read, so
 * a named fallback is taken as a runner registered. */
test.each(named)(
  "a project naming %s with no pool clears an owner's work whatever the reader's own runner",
  (_named, fallback) => {
    expect(
      workRunner(toRunners, noPool, fallback, workRunnerNoPersonal, "Unknown"),
    ).toBe("Clear");
  },
);

test("the question is held while the fallback is unread and could still say no runner", () => {
  const none = workRunnerNoPersonal;
  expect(
    workRunner(toRunners, unregistered, workRunnerUnread, none, "Unknown"),
  ).toBe("Held");
  expect(workRunner(toRunners, live, workRunnerUnread, none, "Unknown")).toBe(
    "Clear",
  );
  expect(
    workRunner(toRunners, unregistered, workRunnerFailed, none, "Reader"),
  ).toBe("Clear");
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
