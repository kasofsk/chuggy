/**
 * An evaluation's bundle pins the identity of the change it was spawned for.
 *
 * `input_bundle_reference_kind_is_known` IS REPLACED, admitting
 * `ChangeIdentity` beside every kind 118 admitted, the stable patch-id of a
 * ticket's change over the reference it lands on, or the empty change's
 * identity.
 */

import type { Migration } from "../shared.ts";

/** Every kind 118 admitted, and the one this adds. */
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
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration148: Migration = {
  version: 148,
  name: "an evaluation's bundle pins the identity of the change it was spawned for",
  statements: [
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
  ],
};
