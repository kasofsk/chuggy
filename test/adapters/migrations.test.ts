/**
 * The declared migration list, checked without a server: one version per
 * migration, ascending in the order they are declared.
 *
 * A COLLIDING VERSION IS INVISIBLE UNTIL A SERVER REFUSES IT. The runner
 * subtracts the applied set and applies the rest in order, so a version
 * declared twice inserts its ledger row twice and the second insert is the
 * only thing that says so — a duplicate key raised deep inside whichever suite
 * happened to open a harness first. That is a slow and misleading way to learn
 * it, and it is decidable here from the list alone.
 *
 * ASCENDING ORDER IS WHAT MAKES THE LIST ITS OWN HISTORY. The runner applies in
 * declaration order rather than by version, so a version out of place would run
 * before one numbered below it and the ledger would record an order no fresh
 * database could reproduce.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { migrations } from "../../src/adapters/postgres/schema.ts";

test("every migration declares its own version", () => {
  const seen = new Map<number, string>();
  for (const migration of migrations) {
    const already = seen.get(migration.version);
    assert.equal(
      already,
      undefined,
      `version ${String(migration.version)} is declared by both ${String(already)} and ${migration.name}`,
    );
    seen.set(migration.version, migration.name);
  }
});

test("versions ascend in the order the list declares them", () => {
  const versions = migrations.map((migration) => migration.version);
  const ascending = [...versions].sort((left, right) => left - right);
  assert.deepEqual(
    versions,
    ascending,
    "the list is applied in declaration order, so it must be declared in version order",
  );
});
