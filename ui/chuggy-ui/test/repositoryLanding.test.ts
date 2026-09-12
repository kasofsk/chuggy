/**
 * What a repository's landing section decides: what a reader's choice becomes,
 * what the write carries, and what each answer to that write means.
 *
 * The conflict is the case worth checking here rather than on the screen — the
 * rebase is what stops two administrators clobbering each other, and it is
 * invisible in a rendering because both drafts draw the same two radios.
 */

import { expect, test } from "vitest";

import type { ProjectRepositoryResponse } from "../../../src/contract/responses.ts";
import type { BriefFinalizationMode } from "../../../src/contract/rosters.ts";
import {
  projectRepositoriesWith,
  projectRepositoryBound,
  repositoryLandingAnswered,
  repositoryLandingChosen,
  repositoryLandingDraft,
  repositoryLandingRebased,
  repositoryLandingRestored,
  repositoryLandingSavable,
  repositoryLandingWrite,
} from "../app/core/repositoryLanding.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";

function binding(
  repository: string,
  mode: BriefFinalizationMode,
): ProjectRepositoryResponse {
  return {
    repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode },
  };
}

test("a draft starts on what the page read, and saves nothing until it moves", () => {
  const draft = repositoryLandingDraft(binding(chuggy, "Push"));
  expect(draft).toStrictEqual({ mode: "Push", read: "Push" });
  expect(repositoryLandingSavable(draft)).toBe(false);
  const moved = repositoryLandingChosen(draft, "PullRequest");
  expect(repositoryLandingSavable(moved)).toBe(true);
  expect(repositoryLandingSavable(repositoryLandingChosen(moved, "Push"))).toBe(
    false,
  );
  expect(repositoryLandingRestored(moved)).toStrictEqual(draft);
});

/** The write fences on the mode the page read and not on the one it wants, so
 * a landing that moved under the reader is refused rather than overwritten. */
test("the write carries the binding, the mode read and the mode wanted", () => {
  const moved = repositoryLandingChosen(
    repositoryLandingDraft(binding(chuggy, "Push")),
    "PullRequest",
  );
  expect(repositoryLandingWrite(moved, chuggy)).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
  });
});

/**
 * A reader who has chosen nothing is shown what now stands; one who has chosen
 * keeps the choice, and the next write fences against the arriving mode so the
 * second attempt is a decision and not a retry of a refused one.
 */
test("a rebase takes the arriving mode, and only an untouched choice with it", () => {
  const arrived = binding(chuggy, "PullRequest");
  const untouched = repositoryLandingDraft(binding(chuggy, "Push"));
  expect(repositoryLandingRebased(untouched, arrived)).toStrictEqual({
    mode: "PullRequest",
    read: "PullRequest",
  });
  const touched = repositoryLandingChosen(untouched, "PullRequest");
  expect(repositoryLandingRebased(touched, binding(chuggy, "Push"))).toEqual({
    mode: "PullRequest",
    read: "Push",
  });
});

test("an accepted write is the binding it answered", () => {
  expect(
    repositoryLandingAnswered({
      outcome: "Ok",
      value: binding(chuggy, "PullRequest"),
    }),
  ).toStrictEqual({
    saved: "Written",
    binding: binding(chuggy, "PullRequest"),
  });
});

/** The route names a moved landing by one code, and the body under it is the
 * row as it now stands; anything else is a failure with its reason. */
test("only the moved code with a readable body is a conflict", () => {
  expect(
    repositoryLandingAnswered({
      outcome: "Conflict",
      code: "RepositoryLandingMoved",
      body: { repository: binding(chuggy, "PullRequest") },
    }),
  ).toStrictEqual({
    saved: "Conflict",
    binding: binding(chuggy, "PullRequest"),
  });
  expect(
    repositoryLandingAnswered({
      outcome: "Conflict",
      code: "RepositoryLandingMoved",
      body: { repository: { repository: chuggy } },
    }),
  ).toStrictEqual({
    saved: "Failed",
    reason: "the API refused this read as RepositoryLandingMoved",
  });
  expect(
    repositoryLandingAnswered({
      outcome: "Conflict",
      code: "SomethingElse",
      body: undefined,
    }),
  ).toStrictEqual({
    saved: "Failed",
    reason: "the API refused this read as SomethingElse",
  });
  expect(repositoryLandingAnswered({ outcome: "Absent" })).toStrictEqual({
    saved: "Failed",
    reason: "the API has no such resource, or will not show it to you",
  });
});

/** The listing is what every other screen reads the landing from, so the row
 * the write answered replaces the stale one and no other row moves. */
test("a written row replaces its own, and the page finds the row it is about", () => {
  const held = {
    repositories: [binding(chuggy, "Push"), binding(scratch, "Push")],
  };
  expect(
    projectRepositoriesWith(held, binding(chuggy, "PullRequest")),
  ).toStrictEqual({
    repositories: [binding(chuggy, "PullRequest"), binding(scratch, "Push")],
  });
  expect(projectRepositoryBound(held, scratch)).toStrictEqual(
    binding(scratch, "Push"),
  );
  expect(projectRepositoryBound(held, "https://forge.test/kasofsk/none")).toBe(
    undefined,
  );
});
