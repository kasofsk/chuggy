import { schemaTextSet, type Migration } from "../shared.ts";

/** The roster as it stood when this migration ran; a later widening moves in its own migration, not here. */
const briefFinalizationModesAt51 = ["Push", "PullRequest"] as const;

/**
 * The enlarged roster, and the two references a proposal stands between: a
 * push may land where its work happened and so may name no target, while a
 * pull request opens from the branch the work happened on into the one it
 * names, so it has both and they differ. The server refuses the pairing
 * rather than leaving a row only the interpreter would have caught.
 */
const briefPullRequestFinalization = [
  `ALTER TABLE draft_brief
     DROP CONSTRAINT draft_brief_finalization_mode_is_known,
     ADD CONSTRAINT draft_brief_finalization_mode_is_known
       CHECK (finalization_mode IN (${schemaTextSet([
         ...briefFinalizationModesAt51,
       ])})),
     ADD CONSTRAINT draft_brief_finalization_is_whole
       CHECK (finalization_mode <> 'PullRequest'
         OR (finalization_target IS NOT NULL AND branch IS NOT NULL
           AND branch <> finalization_target))`,
];

/**
 * A ticket may finish by opening a change proposal into the reference its brief
 * names. The doors that write a brief already carry the mode and the target, so
 * nothing here replaces one: the roster and the pairing are the whole of what
 * this mode adds to the brief's own relation.
 */
export const migration051: Migration = {
  version: 51,
  name: "the brief's pull request finalization",
  statements: [...briefPullRequestFinalization],
};
