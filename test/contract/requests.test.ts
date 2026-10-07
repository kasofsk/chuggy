/**
 * The request bodies whose rule is the body's own rather than a field's: a
 * repository's landing default, the write that moves it, and the pairing a
 * draft's authoring and its brief have to stand in.
 *
 * The brief's own bounds are `brief.test.ts`; what is here is what neither
 * schema inside a draft body can state about the other.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";

import {
  draftCreationSchema,
  draftRevisionSchema,
  projectRepositoryLandingSchema,
  repositoryLandingSchema,
} from "../../src/contract/requests.ts";
import { authoringWireBody } from "./representations.ts";

test("a landing names a mode the wire publishes and nothing else", () => {
  assert.deepEqual(repositoryLandingSchema.parse({ mode: "Push" }), {
    mode: "Push",
  });
  assert.deepEqual(repositoryLandingSchema.parse({ mode: "PullRequest" }), {
    mode: "PullRequest",
  });
  for (const value of [
    {},
    { mode: "Merge" },
    { mode: "Push", target: "refs/heads/main" },
  ])
    assert.equal(
      repositoryLandingSchema.safeParse(value).success,
      false,
      `a landing is refused: ${JSON.stringify(value)}`,
    );
});

test("a landing write names the repository, the landing read and the one wanted", () => {
  const body = {
    repository: "https://github.com/kasofsk/chuggy.git",
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
  };
  assert.deepEqual(projectRepositoryLandingSchema.parse(body), body);
  for (const value of [
    { repository: body.repository, landing: body.landing },
    { repository: body.repository, expected: body.expected },
    { expected: body.expected, landing: body.landing },
    { ...body, repository: "" },
    { ...body, expected: { mode: "Merge" } },
  ])
    assert.equal(
      projectRepositoryLandingSchema.safeParse(value).success,
      false,
      `a landing write is refused: ${JSON.stringify(value)}`,
    );
});

/**
 * The same authoring and brief as each door writes them, so a landing is judged
 * on both bodies that carry one.
 */
function draftBodiesBySchema(
  finalization: { readonly mode: string; readonly target?: string } | undefined,
): readonly (readonly [z.ZodType, Record<string, unknown>])[] {
  const authoring = authoringWireBody;
  const brief = {
    intent: "Do it.",
    links: [],
    branch: "refs/heads/rt/landing",
    ...(finalization === undefined ? {} : { finalization }),
  };
  return [
    [
      draftCreationSchema,
      {
        configurationRevision: "revision-one",
        configurationDigest: "a".repeat(64),
        expectedProjectSequence: 4,
        authoring,
        brief,
      },
    ],
    [
      draftRevisionSchema,
      {
        expectedVersion: 2,
        configurationRevision: "revision-one",
        authoring,
        brief,
      },
    ],
  ];
}

/**
 * Both doors take every landing the roster holds, because nothing in an
 * authoring answers where its ticket lands any more.
 */
test("a draft body takes any landing its brief names, and none at all", () => {
  for (const finalization of [
    undefined,
    { mode: "None" },
    { mode: "Push" },
    { mode: "PullRequest", target: "refs/heads/main" },
    { mode: "PullRequestMerge", target: "refs/heads/main" },
  ])
    for (const [schema, body] of draftBodiesBySchema(finalization))
      assert.equal(
        schema.safeParse(body).success,
        true,
        `a brief landing ${JSON.stringify(finalization)} is accepted`,
      );
});

/**
 * A draft may replace how its work is done and nothing else: the image, every
 * authority, the review block and the evaluation list stay the configuration's.
 */
test("a draft body takes overrides of how the work is done, and refuses any other field", () => {
  const accepted = {
    worker: {
      mode: { type: "SingleAgent", agent: "Claude", arguments: ["--fast"] },
      setup: ["npm ci"],
      files: [{ path: ".npmrc", content: "fund=false" }],
    },
    practices: ["RegressionCoverage"],
    brief: { motivation: ["Why."], acceptanceCriteria: [], constraints: [] },
    work: { instructions: ["Do it."] },
  };
  for (const [schema, body] of draftBodiesBySchema(undefined)) {
    assert.equal(
      schema.safeParse({ ...body, overrides: accepted }).success,
      true,
      "every overridable field is accepted",
    );
    for (const overrides of [
      { image: "worker:v2" },
      { authority: { network: true } },
      { work: { instructions: ["Do it."], authority: { network: true } } },
      { work: { commands: ["./run"] } },
      { review: { instructions: ["Look."] } },
      { evaluations: [] },
      { finalizationApprovalRequired: false },
      { executionRequirements: {} },
      { outputs: {} },
      { version: 1 },
      { worker: { arguments: [] } },
      { worker: { mode: { type: "Commands", commands: ["./run"] } } },
      { brief: { checks: ["npm test"] } },
    ])
      assert.equal(
        schema.safeParse({ ...body, overrides }).success,
        false,
        `an override is refused: ${JSON.stringify(overrides)}`,
      );
  }
});
