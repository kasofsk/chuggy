import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
  asIdempotencyKey,
  asOperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessHeld,
  postgresHarnessConfiguration,
  postgresHarnessReleaseSubmission,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  postgresHarnessWriter,
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

async function draftFixture(canonical = postgresHarnessConfiguration) {
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
    canonical,
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

function releaseSubmission(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Submission {
  const unique = randomUUID();
  return {
    partition: fixture.partition,
    operation: asOperationId(`release-${unique}`),
    authority,
    key: asIdempotencyKey(`release-${unique}`),
    command: {
      version: 1,
      command: "ReleaseDraft",
      ticket: fixture.draft.ticket,
      authoringVersion: fixture.draft.authoringVersion,
      configurationRevision: fixture.revision,
    },
  };
}

async function assertReleaseConfigurationPinned(
  fixture: Awaited<ReturnType<typeof draftFixture>>,
): Promise<void> {
  assert.deepEqual(
    await harness.query(
      `SELECT configuration_revision,configuration_digest
         FROM journal_entry WHERE tenant=$1 AND project=$2 AND seq=1`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [
      {
        configuration_revision: fixture.revision,
        configuration_digest: createHash("sha256")
          .update(postgresHarnessConfiguration)
          .digest("hex"),
      },
    ],
  );
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
  assert.deepEqual(
    await store.createConfiguration({
      partition,
      authority,
      revision,
      parent: asConfigurationRevisionId(`missing-${randomUUID()}`),
      canonical,
    }),
    { created: "IdentityConflict" },
  );
});

test("configuration revision identity is project-local", async () => {
  const first = await postgresHarnessProject(harness.store, "config-local-a");
  const second = await postgresHarnessProject(harness.store, "config-local-b");
  const revision = asConfigurationRevisionId(`shared-${randomUUID()}`);
  const canonical = asCanonicalConfiguration("{}");
  const store = postgresAuthoring(pool);

  const results = await Promise.all(
    [first, second].map(async (partition) =>
      store.createConfiguration({
        partition,
        authority,
        revision,
        canonical,
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.created),
    ["Created", "Created"],
  );
});

test("configuration reads reject content that contradicts its digest", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "config-read-integrity",
  );
  const revision = asConfigurationRevisionId(`integrity-${randomUUID()}`);
  const store = postgresAuthoring(pool);
  await store.createConfiguration({
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration('{"image":"worker:v1"}'),
  });
  await harness.query(
    `UPDATE configuration_revision SET canonical='{"image":"tampered"}'
      WHERE tenant=$1 AND project=$2 AND revision=$3`,
    [partition.tenant, partition.project, revision],
  );

  await assert.rejects(
    store.configuration(partition, revision),
    /content contradicts its digest/,
  );
});

test("concurrent identical configuration creation is idempotent", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "config-concurrent",
  );
  const revision = asConfigurationRevisionId(`concurrent-${randomUUID()}`);
  const input = {
    partition,
    authority,
    revision,
    canonical: asCanonicalConfiguration("{}"),
  };
  const store = postgresAuthoring(pool);
  const results = await Promise.all([
    store.createConfiguration(input),
    store.createConfiguration(input),
  ]);

  assert.deepEqual(results.map((result) => result.created).sort(), [
    "AlreadyExists",
    "Created",
  ]);
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

test("a domain release advances the shared ticket identity allocator", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "authoring-existing-ticket",
  );
  const submission = await postgresHarnessReleaseSubmission(
    harness,
    partition,
    "existing-ticket",
  );
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    partition,
    "existing-ticket",
  );
  const writer = postgresHarnessWriter(harness);
  assert.equal(
    (
      await projectWriterDecide(
        writer,
        await projectWriterLoad(writer, lease),
        input,
      )
    ).decided.decided,
    "Committed",
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
  assert.equal(created.created === "Created" ? created.draft.ticket : 0, 2);
});

test("release journals the retained draft only while its revision is current", async () => {
  const fixture = await draftFixture();
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "draft-release",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Committed");
  assert.deepEqual(
    await harness.query(
      "SELECT state FROM draft WHERE tenant=$1 AND project=$2 AND ticket=$3",
      [
        fixture.partition.tenant,
        fixture.partition.project,
        fixture.draft.ticket,
      ],
    ),
    [{ state: "Released" }],
  );
  await assertReleaseConfigurationPinned(fixture);
  assert.deepEqual(
    await harness.query(
      `SELECT kind,resource,project_seq,authoring_version
         FROM project_notification WHERE tenant=$1 AND project=$2 AND ordinal>=3
        ORDER BY ordinal`,
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [
      {
        kind: "Draft",
        resource: String(fixture.draft.ticket),
        project_seq: null,
        authoring_version: "1",
      },
      {
        kind: "Operation",
        resource: submission.operation,
        project_seq: "1",
        authoring_version: null,
      },
      {
        kind: "Ticket",
        resource: String(fixture.draft.ticket),
        project_seq: "1",
        authoring_version: null,
      },
    ],
  );
});

test("semantic configuration failure durably refuses release without an entry", async () => {
  const fixture = await draftFixture(asCanonicalConfiguration("{}"));
  const submission = releaseSubmission(fixture);
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "invalid-configuration",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT state,outcome_code FROM decision_input WHERE input_id=$1",
      [submission.operation],
    ),
    [{ state: "Refused", outcome_code: "ConfigurationInvalid" }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT head FROM project WHERE tenant=$1 AND project=$2",
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ head: "0" }],
  );
});

test("an edit after acceptance durably refuses release without an entry", async () => {
  const fixture = await draftFixture();
  const submission = releaseSubmission(fixture);
  const acceptance = await harness.inbox.accept(submission);
  assert.equal(acceptance.accepted, "Accepted");
  const input = await harness.discovery.next(fixture.partition);
  assert.ok(input !== undefined);
  await fixture.store.reviseDraft({
    partition: fixture.partition,
    authority,
    ticket: fixture.draft.ticket,
    expectedVersion: 1,
    configurationRevision: fixture.revision,
    authoring: plainAuthoring,
  });
  const lease = await postgresHarnessHeld(
    harness.store,
    fixture.partition,
    "draft-race",
  );
  const writer = postgresHarnessWriter(harness);
  const result = await projectWriterDecide(
    writer,
    await projectWriterLoad(writer, lease),
    input,
  );
  assert.equal(result.decided.decided, "Refused");
  assert.deepEqual(
    await harness.query(
      "SELECT state,outcome_code FROM decision_input WHERE input_id=$1",
      [submission.operation],
    ),
    [{ state: "Refused", outcome_code: "AuthoringChanged" }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT head FROM project WHERE tenant=$1 AND project=$2",
      [fixture.partition.tenant, fixture.partition.project],
    ),
    [{ head: "0" }],
  );
});

test("release acceptance rejects a revision that was never retained", async () => {
  const fixture = await draftFixture();
  const valid = releaseSubmission(fixture);
  const submission: Submission = {
    ...valid,
    command: {
      version: 1,
      command: "ReleaseDraft",
      ticket: fixture.draft.ticket,
      authoringVersion: fixture.draft.authoringVersion + 1,
      configurationRevision: fixture.revision,
    },
  };

  assert.equal(
    (await harness.inbox.accept(submission)).accepted,
    "InvalidCommand",
  );
  assert.equal(await harness.discovery.next(fixture.partition), undefined);
});
