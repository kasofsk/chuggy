/**
 * A merge queue's failed checks are named where the forge let them be read:
 * on the attempt a `QueueChecksFailed` failure records, and on the hold a
 * spent rework of one is left at.
 *
 * `finalization_attempt` GAINS `queue_failed_checks` AND
 * `queue_failed_checks_truncated`, the names and whether they were cut, set
 * together and only on a `QueueChecksFailed` failure, which never requires
 * them. Every row there is keeps neither. The finalizer's insert is granted on
 * the whole table; the scheduler, which 107 granted named columns alone, is
 * granted these two, since a rework's briefing is read from them.
 *
 * `finalization_request` GAINS `hold_failed_checks` AND
 * `hold_failed_checks_truncated`, the same pair on a hold, admitted only at
 * `ProposalMergesExhausted` and never required there, since other holds share
 * that kind. Every row there is keeps neither. They are granted to the
 * boundary owner as 192 granted the hold's paths, because the one door writing
 * them runs as that role.
 *
 * BOTH PAIRS ARE BOUNDED AS ONE REMOVAL'S NAMES ARE: as many as
 * `queueFailedChecksMax`, none empty and none longer than
 * `queueFailedCheckCharsMax`. A name is a briefing line, which holds no line
 * break, so the names joined by one have no longer run than their longest.
 *
 * `record_finalization_hold` IS DROPPED AND RECREATED, because its signature
 * gains the pair, and its body is 192's writing them beside the kind: where a
 * pass names none and the hold stays at `ProposalMergesExhausted`, the names
 * it already has are kept. Dropping it takes its owner and its grant, so both
 * are given again as 192 gave them.
 *
 * THE LANDINGS DOOR IS DROPPED AND RECREATED as 206's answering both pairs as
 * well, because a result type cannot change in place; its owner and grants
 * are given again as 206 gave them.
 */

import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { migration192 } from "./192-target-paths-refused.ts";
import { migration206 } from "./206-forge-answers.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const holdSignatureOld = `public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text, in_paths text[], in_paths_truncated boolean)`;

const holdSignature = `public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text, in_paths text[], in_paths_truncated boolean, in_failed_checks text[], in_failed_checks_truncated boolean)`;

/** The most names one removal keeps, which is `queueFailedChecksMax` at 220. */
const queueFailedChecksMaxAt220 = 5;

/** The longest name one removal keeps, which is `queueFailedCheckCharsMax` at 220. */
const queueFailedCheckCharsMaxAt220 = 36;

/** The CHECK one pair of columns is held to, kept only where `kind` holds. */
function failedChecksWhole(
  names: string,
  truncated: string,
  kind: string,
): string {
  return `((((${names} IS NULL) = (${truncated} IS NULL))
            AND ((${names} IS NULL)
                 OR ((${kind})
                     AND (cardinality(${names}) >= 1)
                     AND (cardinality(${names}) <= ${String(queueFailedChecksMaxAt220)})
                     AND (array_position(${names}, NULL::text) IS NULL)
                     AND (array_position(${names}, ''::text) IS NULL)
                     AND (array_to_string(${names}, E'\\n'::text) !~ '[^\\n]{${String(queueFailedCheckCharsMaxAt220 + 1)}}'::text)))))`;
}

/** One piece of a door and the piece that replaces it, each found exactly once. */
type MigrationWidening = readonly [string, string];

const holdWidenings: readonly MigrationWidening[] = [
  [
    "hold_paths_truncated = in_paths_truncated\n",
    `hold_paths_truncated = in_paths_truncated,
              hold_failed_checks = CASE
                WHEN in_failed_checks IS NOT NULL THEN in_failed_checks
                WHEN in_kind = 'ProposalMergesExhausted'
                     AND f.hold_kind = 'ProposalMergesExhausted'
                  THEN f.hold_failed_checks END,
              hold_failed_checks_truncated = CASE
                WHEN in_failed_checks IS NOT NULL THEN in_failed_checks_truncated
                WHEN in_kind = 'ProposalMergesExhausted'
                     AND f.hold_kind = 'ProposalMergesExhausted'
                  THEN f.hold_failed_checks_truncated END
`,
  ],
];

const landingsWidenings: readonly MigrationWidening[] = [
  [
    "merges_asked integer, merge_answer jsonb)",
    "merges_asked integer, merge_answer jsonb,\n                  failed_checks text[], failed_checks_truncated boolean,\n                  hold_failed_checks text[],\n                  hold_failed_checks_truncated boolean)",
  ],
  [
    "f.held_since, f.hold_paths, f.hold_paths_truncated,\n",
    "f.held_since, f.hold_paths, f.hold_paths_truncated,\n               f.hold_failed_checks, f.hold_failed_checks_truncated,\n",
  ],
  [
    "c.merge_attempts, c.forge_answers->'merge'\n",
    "c.merge_attempts, c.forge_answers->'merge',\n             a.queue_failed_checks, a.queue_failed_checks_truncated,\n             s.hold_failed_checks, s.hold_failed_checks_truncated\n",
  ],
];

/** The statement `stood` installs beginning `CREATE FUNCTION signature`, widened piece by piece. */
function migration220Widened(
  stood: Migration,
  signature: string,
  widenings: readonly MigrationWidening[],
): string {
  const statement = stood.statements.find((candidate) =>
    candidate.startsWith(`CREATE FUNCTION ${signature}`),
  );
  if (statement === undefined)
    throw new Error(
      `migration 220: ${String(stood.version)} no longer installs ${signature}`,
    );
  return widenings.reduce((door, [from, to]) => {
    if (door.split(from).length !== 2)
      throw new Error(
        `migration 220: ${String(stood.version)}'s door does not hold ${JSON.stringify(from)} exactly once`,
      );
    return door.replace(from, to);
  }, statement);
}

/** 192's hold door over the new signature, keeping the names a hold at merges exhausted already has. */
function migration220Hold(): string {
  const widened = migration220Widened(
    migration192,
    `public.record_finalization_hold(`,
    holdWidenings,
  );
  const opened = widened.indexOf(" RETURNS ");
  if (opened < 0)
    throw new Error("migration 220: 192's hold door names no result");
  return `CREATE FUNCTION ${holdSignature}${widened.slice(opened)}`;
}

export const migration220: Migration = {
  version: 220,
  name: "a merge queue's failed checks are named on the attempt and the hold",
  statements: [
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN queue_failed_checks text[],
       ADD COLUMN queue_failed_checks_truncated boolean,
       ADD CONSTRAINT finalization_attempt_queue_failed_checks_are_whole
         CHECK ${failedChecksWhole("queue_failed_checks", "queue_failed_checks_truncated", "failure_kind IS NOT DISTINCT FROM 'QueueChecksFailed'::text")}`,
    `GRANT SELECT (queue_failed_checks, queue_failed_checks_truncated)
       ON TABLE public.finalization_attempt TO ${schedulerRole}`,
    `ALTER TABLE public.finalization_request
       ADD COLUMN hold_failed_checks text[],
       ADD COLUMN hold_failed_checks_truncated boolean,
       ADD CONSTRAINT finalization_request_hold_failed_checks_are_whole
         CHECK ${failedChecksWhole("hold_failed_checks", "hold_failed_checks_truncated", "hold_kind IS NOT DISTINCT FROM 'ProposalMergesExhausted'::text")}`,
    `GRANT UPDATE(hold_failed_checks) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(hold_failed_checks_truncated) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${holdSignatureOld}`,
    migration220Hold(),
    `ALTER FUNCTION ${holdSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${holdSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${holdSignature} TO ${finalizerRole}`,
    `DROP FUNCTION ${landingsSignature}`,
    migration220Widened(migration206, landingsSignature, landingsWidenings),
    `ALTER FUNCTION ${landingsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landingsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
  ],
};
