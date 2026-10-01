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
  runnersPlacementSavable,
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

test("a draft starts on each kind's route where the reader may choose it", () => {
  expect(runnersPlacementDraft(hosted, sessions)).toStrictEqual({
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  });
});

test("a draft starts a hosted route the reader may not choose on one they may, each from its own placement's choices", () => {
  expect(
    runnersPlacementDraft(hosted, { ...sessions, choices: ["Pool"] }),
  ).toStrictEqual({
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "Pool",
  });
  expect(
    runnersPlacementDraft({ ...hosted, choices: ["Pool"] }, sessions),
  ).toStrictEqual({
    work: "Pool",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  });
});

test("a draft is savable only where every route in it is one the reader may choose from its own placement", () => {
  const draft = {
    work: "InCluster",
    evaluation: "Pool",
    thread: "Pool",
    lead: "InCluster",
  } as const;
  const both = ["InCluster", "Pool"] as const;
  expect(runnersPlacementSavable(draft, both, both)).toBe(true);
  expect(runnersPlacementSavable(draft, ["Pool"], both)).toBe(false);
  expect(runnersPlacementSavable(draft, both, ["Pool"])).toBe(false);
  expect(
    runnersPlacementSavable(
      { ...draft, work: "Pool", evaluation: "InCluster" },
      ["Pool"],
      both,
    ),
  ).toBe(false);
  expect(
    runnersPlacementSavable(
      { ...draft, thread: "InCluster", lead: "Pool" },
      both,
      ["Pool"],
    ),
  ).toBe(false);
  expect(runnersPlacementSavable(draft, [], both)).toBe(false);
  expect(runnersPlacementSavable(draft, both, [])).toBe(false);
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
