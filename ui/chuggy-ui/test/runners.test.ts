/**
 * The Runners page's words and drafts, derived: what a route and its source
 * are called, which route a draft starts on, what a write answered, the
 * package a machine is handed with its commands and its guide, and where the
 * control that hands it over is drawn.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
  WorkerPoolsResponse,
} from "../../../src/contract/responses.ts";
import { sessionRunnerStandings } from "../../../src/contract/rosters.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  runnerAddPlace,
  runnerCapabilityLabel,
  runnerPackageOffered,
  runnerPackages,
  runnerRegisterCommand,
  runnerStandingLabel,
  runnersPlacementAnswered,
  runnersPlacementDraft,
  runnersPlacementMoved,
  runnersPlacementOptions,
  runnersPlacementWrites,
} from "../app/core/runners.ts";

const hosted: ExecutionPlacementResponse = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "Pool", source: "Default" },
  choices: ["InCluster", "Pool"],
};

const sessions: SessionPlacementResponse = {
  thread: { route: "Pool", source: "Default" },
  lead: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
  runners: { mine: "Live", project: "Live" },
};

/** A route the reader may not choose is where the kind runs until they choose
 * another, so the draft starts there rather than on one they may. */
test("a draft starts on each kind's route as read, whether or not the reader may choose it", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  };
  expect(runnersPlacementDraft(hosted, sessions)).toStrictEqual(read);
  expect(
    runnersPlacementDraft(
      { ...hosted, choices: ["Pool"] },
      { ...sessions, choices: ["Pool"] },
    ),
  ).toStrictEqual(read);
});

/** The read is the newest one, so a kind the reader left alone follows what
 * anyone else did to it. */
test("a kind the reader moved is where they moved it, and every other is as read", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  } as const;
  expect(runnersPlacementMoved(read, {})).toStrictEqual(read);
  expect(runnersPlacementMoved(read, { thread: "InCluster" })).toStrictEqual({
    ...read,
    thread: "InCluster",
  });
});

test("a kind offers the reader's choices, after its route as read where that is not one of them", () => {
  expect(runnersPlacementOptions("InCluster", ["Pool"])).toStrictEqual([
    { route: "InCluster", choosable: false },
    { route: "Pool", choosable: true },
  ]);
  expect(runnersPlacementOptions("Pool", ["InCluster", "Pool"])).toStrictEqual([
    { route: "InCluster", choosable: true },
    { route: "Pool", choosable: true },
  ]);
  expect(runnersPlacementOptions("Pool", ["Pool"])).toStrictEqual([
    { route: "Pool", choosable: true },
  ]);
});

/** A write names both its kinds, so a placement is written whole where either
 * moved and not at all where neither did. */
test("a save writes only the placements the draft moved, each whole", () => {
  const read = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  } as const;
  expect(runnersPlacementWrites(read, read)).toStrictEqual({
    execution: undefined,
    session: undefined,
  });
  expect(runnersPlacementWrites(read, { ...read, work: "Pool" })).toStrictEqual(
    { execution: { work: "Pool", evaluation: "Pool" }, session: undefined },
  );
  expect(
    runnersPlacementWrites(read, { ...read, evaluation: "InCluster" }),
  ).toStrictEqual({
    execution: { work: "InCluster", evaluation: "InCluster" },
    session: undefined,
  });
  expect(runnersPlacementWrites(read, { ...read, lead: "Pool" })).toStrictEqual(
    { execution: undefined, session: { thread: "Pool", lead: "Pool" } },
  );
  expect(
    runnersPlacementWrites(read, { ...read, thread: "InCluster" }),
  ).toStrictEqual({
    execution: undefined,
    session: { thread: "InCluster", lead: "InCluster" },
  });
});

test("a runner standing is one word, and no runner at all is None", () => {
  expect(sessionRunnerStandings.map(runnerStandingLabel)).toStrictEqual([
    "None",
    "Offline",
    "Live",
  ]);
});

test("a write refused for the hosted grant is told apart from any other refusal", () => {
  expect(
    runnersPlacementAnswered({
      outcome: "Rejected",
      code: "HostedRunsNotGranted",
      status: 403,
      body: undefined,
    }),
  ).toStrictEqual({ saved: "Unhosted" });
  expect(
    runnersPlacementAnswered({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }).saved,
  ).toBe("Failed");
  expect(
    runnersPlacementAnswered({ outcome: "Ok", value: hosted }),
  ).toStrictEqual({ saved: "Written", placement: hosted });
});

test("the package offered is the Linux one: what it needs, the command that installs its current release, and its guide", () => {
  expect(runnerPackageOffered).toBe(runnerPackages.linux);
  expect(runnerPackageOffered).toStrictEqual({
    program: "chuggy-linux",
    platforms: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    needs: "Linux · Node 24 · Docker or Podman",
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-linux/releases/latest/download/chuggy-linux.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-linux#configure",
  });
});

test("the register command names the package's program, the console's own origin and the token, and nothing else", () => {
  expect(
    runnerRegisterCommand(
      runnerPackageOffered,
      "https://chuggy.test",
      "tok_en-1",
    ),
  ).toBe("chuggy-linux register --api https://chuggy.test --token=tok_en-1");
  expect(
    runnerRegisterCommand(
      { ...runnerPackageOffered, program: "chuggy-darwin" },
      "https://chuggy.test",
      "tok_en-1",
    ),
  ).toBe("chuggy-darwin register --api https://chuggy.test --token=tok_en-1");
});

/** A base64url token may start with a dash, which an argument parser takes for
 * a flag unless the token is joined to its own. */
test("a token that starts with a dash stays the token's value", () => {
  expect(
    runnerRegisterCommand(runnerPackageOffered, "https://chuggy.test", "-tok"),
  ).toBe("chuggy-linux register --api https://chuggy.test --token=-tok");
});

function roster(count: number): PanelState<WorkerPoolsResponse> {
  return {
    state: "Ready",
    observedAtMs: undefined,
    value: {
      truncated: false,
      pools: Array.from({ length: count }, (_, at) => ({
        pool: `pool-${String(at)}`,
        capabilities: ["Platform:Linux:Amd64"],
        registeredAt: "2026-09-29T00:00:00Z",
      })),
    },
  };
}

const adding = { administers: true, roster: roster(0), stepsDrawn: false };

test("a reader who may add is drawn the control under an empty roster's line, and in the head once a runner is registered", () => {
  expect(runnerAddPlace(adding)).toBe("Empty");
  expect(runnerAddPlace({ ...adding, roster: roster(1) })).toBe("Head");
  expect(
    runnerAddPlace({ ...adding, roster: roster(1), stepsDrawn: true }),
  ).toBe("Head");
});

test("a reader who may not add is drawn the control nowhere, whatever the roster holds", () => {
  for (const held of [roster(0), roster(1)])
    expect(
      runnerAddPlace({ ...adding, administers: false, roster: held }),
    ).toBeUndefined();
});

test("the control is drawn nowhere while the roster is unread, and in the head where its read came to nothing", () => {
  expect(
    runnerAddPlace({ ...adding, roster: { state: "Pending" } }),
  ).toBeUndefined();
  for (const state of ["Absent", "Failed"] as const)
    expect(
      runnerAddPlace({ ...adding, roster: { state, reason: "no" } }),
      state,
    ).toBe("Head");
});

test("an empty roster's control is not drawn again under the steps it opened", () => {
  expect(runnerAddPlace({ ...adding, stepsDrawn: true })).toBeUndefined();
});

test("a platform is drawn by its parts and any other capability as spelled", () => {
  expect(runnerCapabilityLabel("Platform:Linux:Amd64")).toBe("Linux Amd64");
  expect(runnerCapabilityLabel("Agent:Claude")).toBe("Agent:Claude");
});
