/**
 * A spawn's bundle names the commit its ticket's change started from, so a
 * check can run only what the change touched.
 *
 * `input_bundle_reference_kind_is_known` WIDENS TO ADMIT `ChangeBase`, beside
 * every kind 039 admitted, so no stored row is refused by the new constraint.
 *
 * THE TICKET SERVICE READS WHERE EACH WORK RESULT STARTED. The base is walked
 * back from a spawn's commit through the work results of its ticket that
 * produced it, which is a read of `execution_result_source.base` beside the
 * `commit` the ticket service already reads; nothing stores the walk's answer
 * but the bundle that pins it.
 */

import { ticketServiceRole, type Migration } from "../shared.ts";

/** Every kind 039 admitted, and the one this adds. */
const inputBundleReferenceKinds = [
  "ResultManifest",
  "ConfigurationRevision",
  "Repository",
  "FinalizationAttempt",
  "ConflictManifest",
  "TargetCommit",
  "ProjectArtifact",
  "ChangeBase",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration054: Migration = {
  version: 54,
  name: "a spawn's bundle names the commit its ticket's change started from",
  statements: [
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
    `GRANT SELECT(base) ON TABLE public.execution_result_source TO ${ticketServiceRole}`,
  ],
};
