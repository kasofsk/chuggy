/**
 * The Runners page's words and drafts, derived: what a route and its source
 * are called, which route a draft starts on, what a write answered, and the
 * command a machine is handed.
 */

import { expect, test } from "vitest";

import type { ExecutionPlacementResponse } from "../../../src/contract/responses.ts";
import {
  runnerCapabilityLabel,
  runnerRegisterCommand,
  runnersPlacementAnswered,
  runnersPlacementDraft,
  runnersPlacementSavable,
} from "../app/core/runners.ts";

const hosted: ExecutionPlacementResponse = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "Pool", source: "Default" },
  choices: ["InCluster", "Pool"],
};

test("a draft starts on each kind's route where the reader may choose it", () => {
  expect(runnersPlacementDraft(hosted)).toStrictEqual({
    work: "InCluster",
    evaluation: "Pool",
  });
});

test("a draft starts a hosted route the reader may not choose on one they may", () => {
  expect(runnersPlacementDraft({ ...hosted, choices: ["Pool"] })).toStrictEqual(
    { work: "Pool", evaluation: "Pool" },
  );
});

test("a draft is savable only where every route in it is one the reader may choose", () => {
  const draft = { work: "InCluster", evaluation: "Pool" } as const;
  expect(runnersPlacementSavable(draft, ["InCluster", "Pool"])).toBe(true);
  expect(runnersPlacementSavable(draft, ["Pool"])).toBe(false);
  expect(
    runnersPlacementSavable({ work: "Pool", evaluation: "InCluster" }, [
      "Pool",
    ]),
  ).toBe(false);
  expect(runnersPlacementSavable(draft, [])).toBe(false);
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
    "chuggy-linux register --api https://chuggy.test --token tok_en-1",
  );
});

test("a platform is drawn by its parts and any other capability as spelled", () => {
  expect(runnerCapabilityLabel("Platform:Linux:Amd64")).toBe("Linux Amd64");
  expect(runnerCapabilityLabel("Agent:Claude")).toBe("Agent:Claude");
});
