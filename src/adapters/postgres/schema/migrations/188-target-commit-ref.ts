/**
 * An evaluation's bundle names the ref the forge holds its target commit on.
 *
 * `input_bundle_reference_kind_is_known` IS REPLACED, admitting
 * `TargetCommitRef` beside every kind 149 admitted.
 */

import type { Migration } from "../shared.ts";

/** Every kind 149 admitted, and the one this adds. */
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
  "Recheck",
  "ExpectedTree",
  "ChangeIdentity",
  "TargetCommitRef",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration188: Migration = {
  version: 188,
  name: "an evaluation's bundle names the ref its target commit is on",
  statements: [
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
  ],
};
