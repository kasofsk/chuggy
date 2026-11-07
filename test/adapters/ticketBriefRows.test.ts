/**
 * What a stored brief's landing reads back as, and the columns a brief's
 * finalization is written to.
 *
 * A ROW IS NOT ASKED WHAT THE BRIEF SAID. The door resolves the landing a
 * brief left unsaid against the repository it names and stores what it
 * resolved, so a target-less `GitMerge` is a landing that was decided rather
 * than a landing nobody named. Reading it back as none would answer a
 * repository's own default as the brief's silence, and the finalizer would
 * then land by the tree's default instead of the project's.
 *
 * A NULL KIND IS A ROW THAT JOINED NO BRIEF. Every brief row names a kind, the
 * one that lands nothing among them, so the null is read back as no landing
 * rather than defended against.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftBriefFinalizationColumns,
  draftBriefFinalizationOf,
  draftBriefOf,
  draftReleaseBriefOf,
} from "../../src/adapters/postgres/ticketBrief.ts";
import {
  asBriefBranch,
  type BriefFinalization,
} from "../../src/interpreter/ticketBrief.ts";

/** Each kind's row beside the finalization it reads back as. */
const storedFinalizations: readonly (readonly [
  {
    readonly finalization_kind: string;
    readonly finalization_mode: string | null;
    readonly finalization_target: string | null;
    readonly finalization_policy: string | null;
  },
  BriefFinalization,
])[] = [
  [
    {
      finalization_kind: "GitMerge",
      finalization_mode: "Push",
      finalization_target: null,
      finalization_policy: "Direct",
    },
    { kind: "GitMerge", mode: "Push", policy: "Direct" },
  ],
  [
    {
      finalization_kind: "GitMerge",
      finalization_mode: "PullRequestMerge",
      finalization_target: "refs/heads/release",
      finalization_policy: "Serialized",
    },
    {
      kind: "GitMerge",
      mode: "PullRequestMerge",
      target: asBriefBranch("refs/heads/release"),
      policy: "Serialized",
    },
  ],
  [
    {
      finalization_kind: "PullRequest",
      finalization_mode: null,
      finalization_target: "refs/heads/main",
      finalization_policy: null,
    },
    { kind: "PullRequest", target: asBriefBranch("refs/heads/main") },
  ],
  [
    {
      finalization_kind: "None",
      finalization_mode: null,
      finalization_target: null,
      finalization_policy: null,
    },
    { kind: "None" },
  ],
];

test("a stored landing reads back as itself, target and policy and all", () => {
  for (const [row, finalization] of storedFinalizations)
    assert.deepEqual(draftBriefFinalizationOf(row), finalization);
});

test("a brief's finalization is written to the columns it reads back from", () => {
  assert.deepEqual(draftBriefFinalizationColumns({}), {
    kind: null,
    mode: null,
    target: null,
    policy: null,
  });
  for (const [row, finalization] of storedFinalizations)
    assert.deepEqual(draftBriefFinalizationColumns({ finalization }), {
      kind: row.finalization_kind,
      mode: row.finalization_mode,
      target: row.finalization_target,
      policy: row.finalization_policy,
    });
});

test("a null kind is a row that states no landing at all", () => {
  assert.equal(
    draftBriefFinalizationOf({
      finalization_kind: null,
      finalization_mode: null,
      finalization_target: null,
      finalization_policy: null,
    }),
    undefined,
  );
});

test("a row whose columns no kind carries is refused rather than read", () => {
  for (const [row, refusal] of [
    [
      {
        finalization_kind: "Merge",
        finalization_mode: null,
        finalization_target: null,
        finalization_policy: null,
      },
      /the kind is not one this tree lands under/u,
    ],
    [
      {
        finalization_kind: "None",
        finalization_mode: null,
        finalization_target: "refs/heads/main",
        finalization_policy: null,
      },
      /lands on no reference/u,
    ],
    [
      {
        finalization_kind: "PullRequest",
        finalization_mode: null,
        finalization_target: null,
        finalization_policy: "Serialized",
      },
      /names no mode and no policy/u,
    ],
    [
      {
        finalization_kind: "GitMerge",
        finalization_mode: "Push",
        finalization_target: null,
        finalization_policy: null,
      },
      /the policy is not one this tree orders landings by/u,
    ],
    [
      {
        finalization_kind: "GitMerge",
        finalization_mode: "PullRequest",
        finalization_target: null,
        finalization_policy: "Direct",
      },
      /the mode is not one a git merge lands by/u,
    ],
  ] as const)
    assert.throws(() => draftBriefFinalizationOf(row), refusal);
});

/**
 * What release reads. The miss it has to tell apart from a landing-less brief
 * is a row that joined nothing at all, and only a column every brief row
 * carries can say which of the two a null kind is.
 */
test("a ticket that lands nothing still has a brief for release to read", () => {
  const unlanded = {
    finalization_kind: null,
    finalization_mode: null,
    finalization_target: null,
    finalization_policy: null,
  };
  assert.deepEqual(
    draftReleaseBriefOf({
      ...unlanded,
      intent: "Do the one thing.",
      checks: ["npm test"],
      repository: "https://example.test/atlas.git",
    }),
    {
      checks: ["npm test"],
      repository: "https://example.test/atlas.git",
    },
  );
  assert.equal(
    draftReleaseBriefOf({
      ...unlanded,
      intent: null,
      checks: null,
      repository: null,
    }),
    undefined,
    "a row that joined no brief at all is the one miss there is",
  );
  assert.deepEqual(
    draftReleaseBriefOf({
      intent: "Do the one thing.",
      finalization_kind: "GitMerge",
      finalization_mode: "Push",
      finalization_target: null,
      finalization_policy: "Serialized",
      checks: null,
      repository: null,
    }),
    {
      checks: [],
      finalization: { kind: "GitMerge", mode: "Push", policy: "Serialized" },
    },
  );
});

test("a whole brief row reads back its finalization beside the rest", () => {
  assert.deepEqual(
    draftBriefOf({
      title: null,
      intent: "Do the one thing.",
      branch: "refs/heads/rt/work",
      repository: null,
      links: null,
      images: null,
      checks: null,
      finalization_kind: "PullRequest",
      finalization_mode: null,
      finalization_target: null,
      finalization_policy: null,
    }),
    {
      intent: "Do the one thing.",
      links: [],
      images: [],
      checks: [],
      branch: "refs/heads/rt/work",
      finalization: { kind: "PullRequest" },
    },
  );
});
