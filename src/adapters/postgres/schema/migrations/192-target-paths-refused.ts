/**
 * A landing whose target changed paths a job of its repository may not push
 * holds at `TargetPathsRefused`, naming the files, and the landings door
 * answers them.
 *
 * `finalization_request_hold_kind_is_known` IS REPLACED, admitting
 * `TargetPathsRefused` beside every kind 116 admitted, so no stored row is
 * refused by it.
 *
 * `finalization_request` GAINS `hold_paths` AND `hold_paths_truncated`, the
 * files such a hold is over and whether they were cut, both set exactly at
 * that kind. Every row there is holds at another kind or none, and keeps
 * neither. They are granted to the boundary owner as 007 granted the hold's
 * other columns, because the one door writing them runs as that role.
 *
 * `record_finalization_hold` IS DROPPED AND RECREATED, because its signature
 * gains the two, and its body is 007's writing them beside the kind. Dropping
 * it takes its owner and its grant, so both are given again as 007 gave them.
 *
 * THE LANDINGS DOOR IS DROPPED AND RECREATED as 181's answering the two
 * columns as well, because a result type cannot change in place; its owner and
 * grants are given again as 181 gave them.
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
import { migration181 } from "./181-finalizer-approval-retired.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const holdSignatureOld = `public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text)`;

const holdSignature = `public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text, in_paths text[], in_paths_truncated boolean)`;

/** The most files one hold names, which is the most one conflict summary carries at 192. */
const holdPathsMaxAt192 = 256;

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The holds 116 admitted, and the one this adds. */
const unavailableKinds = [
  "RepositoryUnbound",
  "TargetUnreadable",
  "ProposalBaseUnreadable",
  "ProposalBaseIsHead",
  "ProposalDenied",
  "ReconciliationUnreadable",
  "ProposalEvidenceUnstorable",
  "ProposalAbsent",
  "ProposalUnaddressed",
  "ProposalUnavailable",
  "PreparationRestartsExhausted",
  "ProposalCreationsExhausted",
  "ProposalMergesExhausted",
  "PromotionDeclined",
  "PromotionWorkflowsRefused",
  "ProposalQueueChecksFailed",
  "ProposalQueueTimedOut",
  "ProposalDequeued",
  "RecheckReworksExhausted",
  "TargetPathsRefused",
];

/** One piece of 181's landings door and the piece that replaces it, each found exactly once. */
const landingsWidenings: readonly (readonly [string, string])[] = [
  [
    "recheck_reason text, recheck_base_ref text)",
    "recheck_reason text, recheck_base_ref text,\n                  hold_paths text[], hold_paths_truncated boolean)",
  ],
  ["f.held_since,\n", "f.held_since, f.hold_paths, f.hold_paths_truncated,\n"],
  [
    "a.recheck_reason, a.recheck_base_ref\n",
    "a.recheck_reason, a.recheck_base_ref, s.hold_paths,\n             s.hold_paths_truncated\n",
  ],
];

/** 181's landings door, answering the files a hold is over as well. */
function migration192Landings(): string {
  const stood = migration181.statements.find((statement) =>
    statement.startsWith(`CREATE FUNCTION ${landingsSignature}`),
  );
  if (stood === undefined)
    throw new Error("migration 192: 181 no longer installs the landings door");
  return landingsWidenings.reduce((door, [from, to]) => {
    if (door.split(from).length !== 2)
      throw new Error(
        `migration 192: 181's landings door does not hold ${JSON.stringify(from)} exactly once`,
      );
    return door.replace(from, to);
  }, stood);
}

export const migration192: Migration = {
  version: 192,
  name: "a landing whose target changed paths no job may push names them",
  statements: [
    `ALTER TABLE public.finalization_request
       DROP CONSTRAINT finalization_request_hold_kind_is_known,
       ADD CONSTRAINT finalization_request_hold_kind_is_known CHECK (((hold_kind IS NULL) OR (hold_kind = ANY (${textArray(unavailableKinds)}))))`,
    `ALTER TABLE public.finalization_request
       ADD COLUMN hold_paths text[],
       ADD COLUMN hold_paths_truncated boolean,
       ADD CONSTRAINT finalization_request_hold_paths_are_whole
         CHECK ((((hold_paths IS NULL) = (hold_paths_truncated IS NULL))
                 AND ((hold_paths IS NULL) = (hold_kind IS DISTINCT FROM 'TargetPathsRefused'::text))
                 AND ((hold_paths IS NULL)
                      OR ((cardinality(hold_paths) >= 1)
                          AND (cardinality(hold_paths) <= ${String(holdPathsMaxAt192)})
                          AND (array_position(hold_paths, NULL::text) IS NULL)
                          AND (array_position(hold_paths, ''::text) IS NULL)))))`,
    `GRANT UPDATE(hold_paths) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(hold_paths_truncated) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${holdSignatureOld}`,
    `CREATE FUNCTION ${holdSignature} RETURNS TABLE(result text, hold_passes integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; current_epoch text; counted integer;
     BEGIN
       SELECT f.state, f.request_generation, f.recovery_epoch, f.claim_owner,
              f.claim_generation
         INTO bound
         FROM finalization_request f
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownRequest'::text, NULL::integer; RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.state NOT IN ('Open', 'Registered')
          OR bound.request_generation <> in_request_generation
          OR bound.recovery_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR in_claim_owner IS NULL
          OR bound.claim_owner IS DISTINCT FROM in_claim_owner
          OR bound.claim_generation IS DISTINCT FROM in_claim_generation
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::integer; RETURN;
       END IF;
       UPDATE finalization_request f
          SET hold_kind = in_kind,
              hold_passes = CASE
                WHEN in_kind IS NULL THEN 0
                WHEN f.hold_kind IS NOT DISTINCT FROM in_kind THEN f.hold_passes + 1
                ELSE 1 END,
              held_since = CASE
                WHEN in_kind IS NULL THEN NULL
                WHEN f.hold_kind IS NOT DISTINCT FROM in_kind THEN f.held_since
                ELSE now() END,
              hold_paths = in_paths,
              hold_paths_truncated = in_paths_truncated
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        RETURNING f.hold_passes INTO counted;
       RETURN QUERY SELECT 'Recorded'::text, counted;
     END $$;`,
    `ALTER FUNCTION ${holdSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${holdSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${holdSignature} TO ${finalizerRole}`,
    `DROP FUNCTION ${landingsSignature}`,
    migration192Landings(),
    `ALTER FUNCTION ${landingsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landingsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
  ],
};
