/**
 * What a finalization named by its kind reads back as in the console's landing
 * choices: its mode, its target, and its policy.
 */

import { expect, test } from "vitest";

import { briefLandingOf } from "../app/core/briefLanding.ts";

test("a finalization reads back as the mode it lands by, its target, and its policy, Direct where its kind names none", () => {
  const target = "refs/heads/main";
  expect(briefLandingOf(undefined)).toBe(undefined);
  expect(
    briefLandingOf({
      kind: "GitMerge",
      mode: "PullRequestMerge",
      target,
      policy: "Serialized",
    }),
  ).toStrictEqual({ mode: "PullRequestMerge", target, policy: "Serialized" });
  expect(
    briefLandingOf({ kind: "GitMerge", mode: "Push", policy: "Direct" }),
  ).toStrictEqual({ mode: "Push", policy: "Direct" });
  expect(briefLandingOf({ kind: "PullRequest", target })).toStrictEqual({
    mode: "PullRequest",
    target,
    policy: "Direct",
  });
  expect(briefLandingOf({ kind: "None" })).toStrictEqual({
    mode: "None",
    policy: "Direct",
  });
});
