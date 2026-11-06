/**
 * What a stored brief's landing reads back as.
 *
 * A ROW IS NOT ASKED WHAT THE BRIEF SAID. The door resolves the landing a
 * brief left unsaid against the repository it names and stores what it
 * resolved, so a target-less `Push` is a landing that was decided rather than
 * a landing nobody named. Reading it back as none would answer a repository's
 * own default as the brief's silence, and the finalizer would then land by the
 * tree's default instead of the project's.
 *
 * A NULL MODE IS A ROW NO WRITER IN THIS TREE MAKES. The door resolves a
 * landing for every draft, and the one that lands nothing is a landing like
 * the rest, so the null is read back as no landing rather than defended
 * against.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftBriefFinalizationMode,
  draftBriefFinalizationOf,
  draftBriefOf,
  draftReleaseBriefOf,
} from "../../src/adapters/postgres/ticketBrief.ts";
import {
  briefFinalizationModeOf,
  briefFinalizationModes,
} from "../../src/contract/rosters.ts";

test("a stored landing reads back as itself, target and all", () => {
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "Push",
      finalization_target: null,
      landing_policy: null,
    }),
    { kind: "GitMerge", mode: "Push", policy: "Direct" },
  );
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "Push",
      finalization_target: "refs/heads/release",
      landing_policy: null,
    }),
    {
      kind: "GitMerge",
      mode: "Push",
      target: "refs/heads/release",
      policy: "Direct",
    },
  );
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "PullRequest",
      finalization_target: "refs/heads/main",
      landing_policy: null,
    }),
    { kind: "PullRequest", target: "refs/heads/main" },
  );
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "None",
      finalization_target: null,
      landing_policy: null,
    }),
    { kind: "None" },
  );
});

test("a null mode is a row that states no landing at all", () => {
  assert.equal(
    draftBriefFinalizationOf({
      finalization_mode: null,
      finalization_target: null,
      landing_policy: null,
    }),
    undefined,
  );
});

test("a mode this tree does not land under is refused rather than read", () => {
  assert.throws(
    () =>
      draftBriefFinalizationOf({
        finalization_mode: "Merge",
        finalization_target: null,
        landing_policy: null,
      }),
    /the mode is not one this tree lands under/u,
  );
  for (const mode of briefFinalizationModes)
    assert.equal(
      briefFinalizationModeOf(
        draftBriefFinalizationOf({
          finalization_mode: mode,
          finalization_target: mode === "None" ? null : "refs/heads/main",
          landing_policy: null,
        }) ?? { kind: "None" },
      ),
      mode,
    );
  assert.throws(
    () =>
      draftBriefFinalizationOf({
        finalization_mode: "None",
        finalization_target: "refs/heads/main",
        landing_policy: null,
      }),
    /lands on no reference/u,
  );
});

/**
 * What release reads. The miss it has to tell apart from a landing-less brief
 * is a row that joined nothing at all, and only a column every brief row
 * carries can say which of the two a null mode is.
 */
test("a ticket that lands nothing still has a brief for release to read", () => {
  assert.deepEqual(
    draftReleaseBriefOf({
      intent: "Do the one thing.",
      finalization_mode: null,
      finalization_target: null,
      landing_policy: null,
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
      intent: null,
      finalization_mode: null,
      finalization_target: null,
      landing_policy: null,
      checks: null,
      repository: null,
    }),
    undefined,
    "a row that joined no brief at all is the one miss there is",
  );
  assert.deepEqual(
    draftReleaseBriefOf({
      intent: "Do the one thing.",
      finalization_mode: "Push",
      finalization_target: null,
      landing_policy: null,
      checks: null,
      repository: null,
    }),
    {
      checks: [],
      finalization: { kind: "GitMerge", mode: "Push", policy: "Direct" },
    },
  );
});

test("a row's policy reads back as its git merge's, and Direct where it names none", () => {
  const row = {
    title: null,
    intent: "Do the one thing.",
    branch: "refs/heads/rt/work",
    repository: null,
    links: null,
    images: null,
    checks: null,
    finalization_mode: "Push",
    finalization_target: null,
  };
  assert.deepEqual(
    draftBriefOf({ ...row, landing_policy: "Serialized" })?.finalization,
    { kind: "GitMerge", mode: "Push", policy: "Serialized" },
  );
  for (const landing_policy of ["Direct", null])
    assert.deepEqual(draftBriefOf({ ...row, landing_policy })?.finalization, {
      kind: "GitMerge",
      mode: "Push",
      policy: "Direct",
    });
  assert.throws(() => draftBriefOf({ ...row, landing_policy: "Stacked" }));
  assert.throws(
    () =>
      draftBriefOf({
        ...row,
        finalization_mode: "PullRequest",
        landing_policy: "Serialized",
      }),
    /nothing orders it/u,
    "a pull request ordered Serialized has no kind to read into",
  );
});

test("a brief's finalization is stored under the mode it lands by", () => {
  assert.equal(draftBriefFinalizationMode({}), null);
  for (const [finalization, mode] of [
    [{ kind: "GitMerge", mode: "Push", policy: "Serialized" }, "Push"],
    [
      { kind: "GitMerge", mode: "PullRequestMerge", policy: "Direct" },
      "PullRequestMerge",
    ],
    [{ kind: "PullRequest" }, "PullRequest"],
    [{ kind: "None" }, "None"],
  ] as const)
    assert.equal(draftBriefFinalizationMode({ finalization }), mode);
});
