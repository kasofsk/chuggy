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
 * A NULL MODE IS THE ONE LANDING THERE IS NONE OF, and it means one thing: a
 * ticket authored to run no finalizer, for which the door resolved nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftBriefFinalizationOf,
  draftReleaseBriefOf,
} from "../../src/adapters/postgres/ticketBrief.ts";
import { briefFinalizationModes } from "../../src/contract/rosters.ts";

test("a stored landing reads back as itself, target and all", () => {
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "Push",
      finalization_target: null,
    }),
    { mode: "Push" },
  );
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "Push",
      finalization_target: "refs/heads/release",
    }),
    { mode: "Push", target: "refs/heads/release" },
  );
  assert.deepEqual(
    draftBriefFinalizationOf({
      finalization_mode: "PullRequest",
      finalization_target: "refs/heads/main",
    }),
    { mode: "PullRequest", target: "refs/heads/main" },
  );
});

test("a ticket that lands nothing has no landing to read", () => {
  assert.equal(
    draftBriefFinalizationOf({
      finalization_mode: null,
      finalization_target: null,
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
      }),
    /the mode is not one this tree lands under/u,
  );
  for (const mode of briefFinalizationModes)
    assert.equal(
      draftBriefFinalizationOf({
        finalization_mode: mode,
        finalization_target: "refs/heads/main",
      })?.mode,
      mode,
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
      checks: null,
      repository: null,
    }),
    { checks: [], finalization: { mode: "Push" } },
  );
});
