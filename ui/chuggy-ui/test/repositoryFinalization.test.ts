/**
 * What a binding's settings sections decide: what a reader's choice becomes,
 * what the write carries, and what each answer to that write means.
 *
 * The conflict is the case worth checking here rather than on the screen — the
 * rebase is what stops two administrators clobbering each other, and it is
 * invisible in a rendering because both drafts draw the same radios.
 */

import { expect, test } from "vitest";
import { copyTextEn } from "../app/copy/catalog.ts";

import type { ProjectRepositoryResponse } from "../../../src/contract/responses.ts";
import type { FinalizationChoice } from "../app/core/finalizationChoice.ts";
import {
  projectRepositoriesWith,
  projectRepositoryBound,
  repositoryFinalizationChosen,
  repositoryFinalizationDraft,
  repositoryFinalizationMoved,
  repositoryFinalizationPipelinesChosen,
  repositoryFinalizationRefusal,
  repositoryFinalizationRebased,
  repositoryFinalizationRestored,
  repositoryFinalizationSavable,
  repositoryFinalizationWrite,
} from "../app/core/repositoryFinalization.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";

const push: FinalizationChoice = {
  kind: "GitMerge",
  mode: "Push",
  policy: "Direct",
};
const serialized: FinalizationChoice = { ...push, policy: "Serialized" };
const proposal: FinalizationChoice = { kind: "PullRequest" };

function binding(
  repository: string,
  finalization: FinalizationChoice,
  pipelinesWritable = false,
): ProjectRepositoryResponse {
  return {
    repository,
    boundAt: "2026-08-26T00:00:00Z",
    landing: {
      mode:
        finalization.kind === "GitMerge"
          ? finalization.mode
          : finalization.kind,
    },
    finalization,
    pipelinesWritable,
  };
}

test("a draft starts on what the page read, and saves nothing until a setting moves", () => {
  const draft = repositoryFinalizationDraft(binding(chuggy, push));
  expect(draft).toStrictEqual({
    finalization: push,
    read: push,
    pipelinesWritable: false,
    pipelinesWritableRead: false,
  });
  expect(repositoryFinalizationSavable(draft)).toBe(false);
  const moved = repositoryFinalizationChosen(draft, proposal);
  expect(repositoryFinalizationSavable(moved)).toBe(true);
  expect(
    repositoryFinalizationSavable(repositoryFinalizationChosen(moved, push)),
  ).toBe(false);
  expect(repositoryFinalizationRestored(moved)).toStrictEqual(draft);
  const ordered = repositoryFinalizationChosen(draft, serialized);
  expect(repositoryFinalizationSavable(ordered)).toBe(true);
  expect(repositoryFinalizationRestored(ordered)).toStrictEqual(draft);
  const allowed = repositoryFinalizationPipelinesChosen(draft, true);
  expect(repositoryFinalizationSavable(allowed)).toBe(true);
  expect(
    repositoryFinalizationSavable(
      repositoryFinalizationPipelinesChosen(allowed, false),
    ),
  ).toBe(false);
  expect(repositoryFinalizationRestored(allowed)).toStrictEqual(draft);
});

/** The write fences on each setting as the page read it and not on the value
 * it wants, so a setting that moved under the reader is refused rather than
 * overwritten — including the one the reader did not touch. */
test("the write carries the binding, and each setting as read and as wanted", () => {
  const moved = repositoryFinalizationChosen(
    repositoryFinalizationDraft(binding(chuggy, push, true)),
    proposal,
  );
  expect(repositoryFinalizationWrite(moved, chuggy)).toStrictEqual({
    repository: chuggy,
    expected: push,
    landing: proposal,
    pipelinesWritable: { expected: true, wanted: true },
  });
  const ordered = repositoryFinalizationChosen(
    repositoryFinalizationDraft(binding(chuggy, push)),
    serialized,
  );
  expect(repositoryFinalizationWrite(ordered, chuggy)).toMatchObject({
    expected: push,
    landing: serialized,
  });
  const allowed = repositoryFinalizationPipelinesChosen(
    repositoryFinalizationDraft(binding(chuggy, push)),
    true,
  );
  expect(repositoryFinalizationWrite(allowed, chuggy)).toStrictEqual({
    repository: chuggy,
    expected: push,
    landing: push,
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
  const arrived = binding(chuggy, proposal, true);
  const untouched = repositoryFinalizationDraft(binding(chuggy, push));
  expect(repositoryFinalizationRebased(untouched, arrived)).toStrictEqual({
    finalization: proposal,
    read: proposal,
    pipelinesWritable: true,
    pipelinesWritableRead: true,
  });
  const touched = repositoryFinalizationChosen(untouched, proposal);
  expect(
    repositoryFinalizationRebased(touched, binding(chuggy, push, true)),
  ).toStrictEqual({
    finalization: proposal,
    read: push,
    pipelinesWritable: true,
    pipelinesWritableRead: true,
  });
  const allowed = repositoryFinalizationPipelinesChosen(untouched, true);
  expect(
    repositoryFinalizationRebased(allowed, binding(chuggy, proposal)),
  ).toStrictEqual({
    finalization: proposal,
    read: proposal,
    pipelinesWritable: true,
    pipelinesWritableRead: false,
  });
});

/** The route names a moved setting by one code, and the body under it is the
 * row as it now stands; anything else is a failure with its reason. */
test("only the moved code with a readable body is a conflict", () => {
  const moved = {
    outcome: "Conflict",
    code: "RepositoryLandingMoved",
    body: { repository: binding(chuggy, proposal) },
  } as const;
  expect(repositoryFinalizationMoved(moved)).toStrictEqual(
    binding(chuggy, proposal),
  );
  expect(copyTextEn(repositoryFinalizationRefusal(moved))).toBe(
    "Settings moved",
  );
  const unreadable = {
    outcome: "Conflict",
    code: "RepositoryLandingMoved",
    body: { repository: { repository: chuggy } },
  } as const;
  expect(repositoryFinalizationMoved(unreadable)).toBeUndefined();
  expect(copyTextEn(repositoryFinalizationRefusal(unreadable))).toBe("Refused");
  const other = {
    outcome: "Conflict",
    code: "SomethingElse",
    body: undefined,
  } as const;
  expect(repositoryFinalizationMoved(other)).toBeUndefined();
  expect(copyTextEn(repositoryFinalizationRefusal(other))).toBe("Refused");
  expect(repositoryFinalizationMoved({ outcome: "Absent" })).toBeUndefined();
  expect(copyTextEn(repositoryFinalizationRefusal({ outcome: "Absent" }))).toBe(
    "Not found",
  );
});

/** The listing is what every other screen reads the finalization from, so the row
 * the write answered replaces the stale one, keeps what only the listing says
 * of it, and no other row moves. */
test("a written row replaces its own, and the page finds the row it is about", () => {
  const holding = {
    configured: true,
    configurationsHeld: { result: "Imported" as const, count: 2 },
  };
  const held = {
    repositories: [
      { ...binding(chuggy, push), ...holding },
      { ...binding(scratch, push), configured: false },
    ],
  };
  expect(
    projectRepositoriesWith(held, binding(chuggy, proposal)),
  ).toStrictEqual({
    repositories: [
      { ...binding(chuggy, proposal), ...holding },
      { ...binding(scratch, push), configured: false },
    ],
  });
  expect(
    projectRepositoriesWith(held, binding(scratch, proposal)),
  ).toStrictEqual({
    repositories: [
      { ...binding(chuggy, push), ...holding },
      { ...binding(scratch, proposal), configured: false },
    ],
  });
  expect(projectRepositoryBound(held, scratch)).toStrictEqual({
    ...binding(scratch, push),
    configured: false,
  });
  expect(projectRepositoryBound(held, "https://forge.test/kasofsk/none")).toBe(
    undefined,
  );
});
