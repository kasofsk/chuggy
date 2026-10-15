/**
 * A pool's refusal of an execution's assignment keeps the image fault the pool
 * named beside its evidence.
 *
 * `pool_refusal_fault` IS WRITTEN WITH THE REFUSAL OR NOT AT ALL. The pool
 * plane sets it in the statement that sets `pool_refusal`, under a column grant
 * of its own beside the one 002 gave it for that, and a fault with no refusal
 * beside it is refused. Every row that stood has neither, or a refusal alone.
 *
 * THE FAULTS ARE THE WORKER CONTRACT'S `workerImageFaults` AS THEY STAND HERE,
 * written out rather than read from it, so this file goes on saying what it
 * installed when that roster grows. A new fault is a new migration.
 *
 * NOTHING READS IT YET. The scheduler's table-level SELECT and INSERT on
 * `execution_attempt` reach it as they reach every column, it writes it in no
 * statement, and it blocks a refused attempt as it did before.
 */

import { poolPlaneRole, type Migration } from "../shared.ts";

const imageFaults = [
  "ImageUnpullable",
  "ImageLacksShell",
  "ImageLibcUnsupported",
  "ImageLacksGit",
  "ImageHomeUnwritable",
  "ImageWorkspaceUnwritable",
  "ImageTmpUnwritable",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration056: Migration = {
  version: 56,
  name: "a pool's refusal keeps the image fault it named",
  statements: [
    `ALTER TABLE public.execution_attempt ADD COLUMN pool_refusal_fault text
       CONSTRAINT execution_attempt_pool_refusal_fault_is_known
       CHECK ((pool_refusal_fault IS NULL OR (pool_refusal_fault = ANY (${textArray(imageFaults)}))))`,
    `ALTER TABLE public.execution_attempt ADD CONSTRAINT execution_attempt_pool_refusal_fault_is_a_refusal_s
       CHECK ((pool_refusal_fault IS NULL OR pool_refusal IS NOT NULL))`,
    `GRANT UPDATE(pool_refusal_fault) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
  ],
};
