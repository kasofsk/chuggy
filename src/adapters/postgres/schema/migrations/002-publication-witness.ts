import type { Migration } from "../shared.ts";

/**
 * The witness a publication must come to hold, pinned on the request beside the
 * bytes it publishes. It is rendered when the request is written and never
 * afterwards, like every other column here, so what a finalization is waiting
 * for cannot be changed while it waits.
 *
 * THE DEADLINE IS A DURATION AND NOT A MOMENT. The moment it is measured from
 * is `commit_permit.concluded_at`, which the server writes; a stored expiry
 * would be a second authority on the same fact and a row nobody could trust
 * after a restore.
 */
export const migration002: Migration = {
  version: 2,
  name: "the publication witness",
  statements: [
    `ALTER TABLE public.finalization_request_configuration
       ADD COLUMN witness_path text,
       ADD COLUMN witness_proven_within_secs bigint`,
    `ALTER TABLE public.finalization_request_configuration
       ADD CONSTRAINT finalization_request_configuration_witness_is_whole
       CHECK ((((witness_path IS NULL) = (witness_proven_within_secs IS NULL))
         AND ((witness_path IS NULL) OR (kind = 'PublishHandoff'::text))))`,
    `ALTER TABLE public.finalization_request_configuration
       ADD CONSTRAINT finalization_request_configuration_witness_is_bounded
       CHECK ((((witness_path IS NULL)
           OR ((length(witness_path) >= 1) AND (length(witness_path) <= 512)))
         AND ((witness_proven_within_secs IS NULL)
           OR ((witness_proven_within_secs >= 1)
             AND (witness_proven_within_secs <= 604800)))))`,
  ],
};
