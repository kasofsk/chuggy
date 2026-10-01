/**
 * The Runners page's words and drafts, derived: what a route and its source
 * are called, which route a draft starts on, what a write answered, and the
 * command a machine is handed.
 */

import { expect, test } from "vitest";

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import { sessionRunnerStandings } from "../../../src/contract/rosters.ts";
import {
  runnerCapabilityLabel,
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

test("the command names the console's own origin and the token, and nothing else", () => {
  expect(runnerRegisterCommand("https://chuggy.test", "tok_en-1")).toBe(
    "chuggy-linux register --api https://chuggy.test --token=tok_en-1",
  );
});

/** A base64url token may start with a dash, which an argument parser takes for
 * a flag unless the token is joined to its own. */
test("a token that starts with a dash stays the token's value", () => {
  expect(runnerRegisterCommand("https://chuggy.test", "-tok")).toBe(
    "chuggy-linux register --api https://chuggy.test --token=-tok",
  );
});

test("a platform is drawn by its parts and any other capability as spelled", () => {
  expect(runnerCapabilityLabel("Platform:Linux:Amd64")).toBe("Linux Amd64");
  expect(runnerCapabilityLabel("Agent:Claude")).toBe("Agent:Claude");
});
