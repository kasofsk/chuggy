import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

const authority = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("author"),
};

async function draftFixture() {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-draft",
  );
  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration("{}"),
  });
  const created = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    authoring: plainAuthoring,
  });
  if (created.created !== "Created")
    throw new Error("draft fixture was not created");
  return { partition, store, revision, draft: created.draft };
}

test("configuration revisions are immutable and parented inside one project", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-config",
  );
  const store = postgresAuthoring(pool);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  const canonical = asCanonicalConfiguration('{"image":"worker:v1"}');
  assert.equal(
    (
      await store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      })
    ).created,
    "Created",
  );
  assert.equal(
    (
      await store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      })
    ).created,
    "AlreadyExists",
  );
  assert.deepEqual(
    await store.createConfiguration({
      partition,
      authority,
      revision,
      canonical: asCanonicalConfiguration('{"image":"worker:v2"}'),
    }),
    { created: "IdentityConflict" },
  );
});

test("draft edits are versioned and deletion leaves an unreusable identity", async () => {
  const { partition, store, revision, draft } = await draftFixture();
  assert.deepEqual(
    await store.reviseDraft({
      partition,
      authority,
      ticket: draft.ticket,
      expectedVersion: 0,
      configurationRevision: revision,
      authoring: plainAuthoring,
    }),
    { revised: "Stale", currentVersion: 1 },
  );
  const revised = await store.reviseDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
  });
  assert.equal(revised.revised, "Revised");
  const deleted = await store.deleteDraft({
    partition,
    authority,
    ticket: draft.ticket,
    expectedVersion: 2,
  });
  assert.equal(deleted.deleted, "Deleted");
  assert.equal(
    deleted.deleted === "Deleted" ? deleted.draft.authoringVersion : 0,
    3,
  );
  assert.deepEqual(
    await store.reviseDraft({
      partition,
      authority,
      ticket: draft.ticket,
      expectedVersion: 3,
      configurationRevision: revision,
      authoring: plainAuthoring,
    }),
    { revised: "NotDraft", state: "Deleted" },
  );
  const next = await store.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    authoring: plainAuthoring,
  });
  assert.equal(
    next.created === "Created" ? next.draft.ticket : 0,
    draft.ticket + 1,
  );
});
