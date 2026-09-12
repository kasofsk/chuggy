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
 * The same authoring and brief as each door writes them, so a pairing is judged
 * on both bodies that carry one.
 */
function draftBodiesBySchema(
  finalizer: string,
  finalization: { readonly mode: string; readonly target?: string } | undefined,
): readonly (readonly [z.ZodType, Record<string, unknown>])[] {
  const authoring = { ...authoringWireBody, finalizer };
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

test("a ticket authored with no finalizer names no landing", () => {
  for (const [schema, body] of draftBodiesBySchema("NoFinalizer", {
    mode: "PullRequest",
    target: "refs/heads/main",
  })) {
    const refused = schema.safeParse(body);
    assert.equal(refused.success, false);
    assert.deepEqual(
      refused.error?.issues.map((issue) => [issue.path, issue.message]),
      [[["brief", "finalization"], "a ticket with no finalizer lands nothing"]],
    );
  }
});

test("every other pairing of a finalizer and a landing is accepted", () => {
  for (const [finalizer, finalization] of [
    ["NoFinalizer", undefined],
    ["ManagedFinalizer", { mode: "PullRequest", target: "refs/heads/main" }],
    ["ManagedFinalizer", undefined],
  ] as const)
    for (const [schema, body] of draftBodiesBySchema(finalizer, finalization))
      assert.equal(
        schema.safeParse(body).success,
        true,
        `${finalizer} with ${JSON.stringify(finalization)} is accepted`,
      );
});
