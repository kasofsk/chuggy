/**
 * What a binding's settings sections decide: what a reader's choice becomes,
 * what the write carries, and what each answer to that write means.
 *
 * The conflict is the case worth checking here rather than on the screen — the
 * rebase is what stops two administrators clobbering each other, and it is
 * invisible in a rendering because both drafts draw the same radios.
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
  repositoryLandingPipelinesChosen,
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
  pipelinesWritable = false,
): ProjectRepositoryResponse {
  return {
    repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: { mode },
    pipelinesWritable,
  };
}

test("a draft starts on what the page read, and saves nothing until a setting moves", () => {
  const draft = repositoryLandingDraft(binding(chuggy, "Push"));
  expect(draft).toStrictEqual({
    mode: "Push",
    read: "Push",
    pipelinesWritable: false,
    pipelinesWritableRead: false,
  });
  expect(repositoryLandingSavable(draft)).toBe(false);
  const moved = repositoryLandingChosen(draft, "PullRequest");
  expect(repositoryLandingSavable(moved)).toBe(true);
  expect(repositoryLandingSavable(repositoryLandingChosen(moved, "Push"))).toBe(
    false,
  );
  expect(repositoryLandingRestored(moved)).toStrictEqual(draft);
  const allowed = repositoryLandingPipelinesChosen(draft, true);
  expect(repositoryLandingSavable(allowed)).toBe(true);
  expect(
    repositoryLandingSavable(repositoryLandingPipelinesChosen(allowed, false)),
  ).toBe(false);
  expect(repositoryLandingRestored(allowed)).toStrictEqual(draft);
});

/** The write fences on each setting as the page read it and not on the value
 * it wants, so a setting that moved under the reader is refused rather than
 * overwritten — including the one the reader did not touch. */
test("the write carries the binding, and each setting as read and as wanted", () => {
  const moved = repositoryLandingChosen(
    repositoryLandingDraft(binding(chuggy, "Push", true)),
    "PullRequest",
  );
  expect(repositoryLandingWrite(moved, chuggy)).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
    pipelinesWritable: { expected: true, wanted: true },
  });
  const allowed = repositoryLandingPipelinesChosen(
    repositoryLandingDraft(binding(chuggy, "Push")),
    true,
  );
  expect(repositoryLandingWrite(allowed, chuggy)).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "Push" },
    pipelinesWritable: { expected: false, wanted: true },
  });
});

/**
 * A reader who has chosen nothing is shown what now stands; one who has chosen
 * keeps the choice, and the next write fences against the arriving value so the
 * second attempt is a decision and not a retry of a refused one. Each setting
 * is rebased on its own, so a choice of one survives the other moving.
 */
test("a rebase takes each arriving setting, and only an untouched choice with it", () => {
  const arrived = binding(chuggy, "PullRequest", true);
  const untouched = repositoryLandingDraft(binding(chuggy, "Push"));
  expect(repositoryLandingRebased(untouched, arrived)).toStrictEqual({
    mode: "PullRequest",
    read: "PullRequest",
    pipelinesWritable: true,
    pipelinesWritableRead: true,
  });
  const touched = repositoryLandingChosen(untouched, "PullRequest");
  expect(
    repositoryLandingRebased(touched, binding(chuggy, "Push", true)),
  ).toStrictEqual({
    mode: "PullRequest",
    read: "Push",
    pipelinesWritable: true,
    pipelinesWritableRead: true,
  });
  const allowed = repositoryLandingPipelinesChosen(untouched, true);
  expect(
    repositoryLandingRebased(allowed, binding(chuggy, "PullRequest")),
  ).toStrictEqual({
    mode: "PullRequest",
    read: "PullRequest",
    pipelinesWritable: true,
    pipelinesWritableRead: false,
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
 * the write answered replaces the stale one, keeps what only the listing says
 * of it, and no other row moves. */
test("a written row replaces its own, and the page finds the row it is about", () => {
  const holding = {
    configured: true,
    configurationsHeld: { result: "Imported" as const, count: 2 },
  };
  const held = {
    repositories: [
      { ...binding(chuggy, "Push"), ...holding },
      { ...binding(scratch, "Push"), configured: false },
    ],
  };
  expect(
    projectRepositoriesWith(held, binding(chuggy, "PullRequest")),
  ).toStrictEqual({
    repositories: [
      { ...binding(chuggy, "PullRequest"), ...holding },
      { ...binding(scratch, "Push"), configured: false },
    ],
  });
  expect(
    projectRepositoriesWith(held, binding(scratch, "PullRequest")),
  ).toStrictEqual({
    repositories: [
      { ...binding(chuggy, "Push"), ...holding },
      { ...binding(scratch, "PullRequest"), configured: false },
    ],
  });
  expect(projectRepositoryBound(held, scratch)).toStrictEqual({
    ...binding(scratch, "Push"),
    configured: false,
  });
  expect(projectRepositoryBound(held, "https://forge.test/kasofsk/none")).toBe(
    undefined,
  );
});
