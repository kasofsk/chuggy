/**
 * A dispatch pins what its ticket's dependencies delivered, and every briefing
 * of the ticket reads it back.
 *
 * `input_bundle_reference_kind_is_known` WIDENS TO ADMIT THE THREE KINDS A
 * DISPATCH PINS of a ticket with dependencies, beside every kind 054 admitted,
 * so no stored row is refused by the new constraint: each dependency's
 * accepted work result, and the commits its change is at that the commit the
 * dispatch observed was found to descend from, or found not to.
 *
 * THE TICKET SERVICE READS WHICH RESULT A DEPENDENCY'S JOURNAL ACCEPTED. The
 * journal names a result by the fold of its digest, so a dispatch reads the
 * digest and verdict of a dependency's work results to find the manifest, and
 * the repository and ref that result was produced at beside the commit it
 * already reads.
 *
 * THE TICKET SERVICE AND THE SCHEDULER READ A DEPENDENCY'S LANDINGS through the
 * door the API answers them from, which reads the projection row of the ticket
 * it is asked about; the scheduler is granted the three columns that row is
 * found by.
 */

import {
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

/** Every kind 054 admitted, and the three this adds. */
const inputBundleReferenceKinds = [
  "ResultManifest",
  "ConfigurationRevision",
  "Repository",
  "FinalizationAttempt",
  "ConflictManifest",
  "TargetCommit",
  "ProjectArtifact",
  "ChangeBase",
  "DependencyResult",
  "DependencyAncestor",
  "DependencyNotAncestor",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

export const migration062: Migration = {
  version: 62,
  name: "a dispatch pins what its ticket's dependencies delivered",
  statements: [
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
    `GRANT SELECT (tenant, project, manifest, digest, verdict)
       ON TABLE public.execution_result TO ${ticketServiceRole}`,
    `GRANT SELECT (repository, ref)
       ON TABLE public.execution_result_source TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
    `GRANT SELECT (tenant, project, ticket)
       ON TABLE public.ticket_projection TO ${schedulerRole}`,
  ],
};
