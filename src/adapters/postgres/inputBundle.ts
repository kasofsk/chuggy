/**
 * The one way an input bundle is written, shared by the two transactions that
 * create one: a preparation pinning what a candidate was built from, and a
 * deciding transaction pinning what a spawned work set consumes.
 *
 * A BUNDLE IS WRITTEN ONCE AND ITS DIGEST COVERS ITS REFERENCES. The digest is
 * taken here rather than passed in, so a caller cannot store references one
 * digest was not computed over; `input_bundle` and `input_bundle_reference`
 * each carry a trigger refusing every UPDATE and DELETE behind that.
 *
 * ORDINALS ARE THE ORDER THE REFERENCES WERE NAMED IN, which is what makes the
 * canonical bytes reproducible from the stored rows.
 */

import { createHash } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  canonicalInputBundle,
  type CanonicalFinalization,
} from "../../interpreter/finalizerPreparation.ts";
import type {
  InputBundle,
  InputBundleId,
  InputBundleReference,
} from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** The hash every canonical construction in this tree is digested under. */
export function postgresInputBundleDigest(
  canonical: CanonicalFinalization,
): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** One bundle under the digest of exactly the references it holds. */
export function postgresInputBundleOf(
  partition: Partition,
  bundle: InputBundleId,
  references: readonly InputBundleReference[],
): InputBundle {
  return {
    bundle,
    digest: postgresInputBundleDigest(
      canonicalInputBundle(partition, bundle, references),
    ),
    references,
  };
}

/** Writes one bundle and the references it pins, in the order they were named. */
export async function postgresInputBundleWrite(
  client: pg.PoolClient,
  partition: Partition,
  bundle: InputBundle,
): Promise<void> {
  await client.query(
    sql`INSERT INTO input_bundle (tenant, project, bundle, digest)
     VALUES (${partition.tenant},${partition.project},${bundle.bundle},${bundle.digest})`,
  );
  const ordinals = bundle.references.map((_reference, index) => index + 1);
  const kinds = bundle.references.map((reference) => reference.kind);
  const references = bundle.references.map((reference) => reference.reference);
  const digests = bundle.references.map(
    (reference) => reference.digest ?? null,
  );
  await client.query(
    sql`INSERT INTO input_bundle_reference
       (tenant, project, bundle, ordinal, reference_kind, reference_id, reference_digest)
     SELECT ${partition.tenant}, ${partition.project}, ${bundle.bundle},
            ordinal, kind, reference, digest
       FROM unnest(${ordinals}::integer[], ${kinds}::text[], ${references}::text[],
                   ${digests}::text[])
         AS r(ordinal, kind, reference, digest)`,
  );
}
