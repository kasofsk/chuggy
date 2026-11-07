/**
 * A draft's brief and a repository's landing default written by mode before
 * 129, moved forward to their kind by it: a push or a merged proposal becomes
 * a `GitMerge` under the policy beside it, `Direct` for a binding, and a pull
 * request or a landing of nothing keeps its kind and drops any policy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import {
  postgresMigrate,
  postgresMigrateCompatible,
} from "../../src/adapters/postgres/pool.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { encodeDraftAuthoring } from "../../src/interpreter/authoring.ts";
import { plainAuthoring } from "../actor/harness.ts";
import { migrationDatabase } from "./migrationHarness.ts";

/** Migrates an empty database through every migration before 129, and no further. */
async function finalizationKindsBefore(subject: pg.Pool): Promise<void> {
  const before = migrations
    .filter(({ version }) => version < 129)
    .map(({ version, name }) => ({ version, name }));
  const contract = { required: before, compatible: before };
  assert.deepEqual(
    await postgresMigrateCompatible(subject, {
      current: contract,
      retainedPrevious: contract,
    }),
    { migrated: "Applied", versions: before.map(({ version }) => version) },
  );
}

/** A project binding one repository at each mode 128 lands by, and a configuration to draft against. */
async function finalizationKindsSeeded(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch-129')`);
  await subject.query(`INSERT INTO tenant(tenant) VALUES('tenant-129')`);
  await subject.query(
    `INSERT INTO project(tenant,project,lifecycle,head,ingress_next,ticket_next)
     VALUES('tenant-129','project-129','Active',0,1,1)`,
  );
  await subject.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch,landing_mode)
     SELECT 'tenant-129','project-129',mode,'epoch-129',mode
       FROM unnest(ARRAY['Push','PullRequest','PullRequestMerge','None']) AS mode`,
  );
  await subject.query(
    `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES('tenant-129','project-129','revision-129','{}','digest-129','User','author')`,
  );
}

/** A draft written through 128's door, by the mode, target and landing given. */
async function finalizationKindsDrafted(
  subject: pg.Pool,
  mode: string,
  target: string | null,
  landing: string | null,
): Promise<void> {
  assert.deepEqual(
    (
      await subject.query<{ result: string }>(
        `SELECT result FROM create_draft(
           'tenant-129','project-129','revision-129','digest-129',0,$1,
           NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],'refs/heads/rt/work',
           $2,$3,NULL,NULL,NULL,'User','author',NULL,$4)`,
        [encodeDraftAuthoring(plainAuthoring), mode, target, landing],
      )
    ).rows,
    [{ result: "Created" }],
  );
}

test("a brief and a binding stored by mode are stored by kind once 129 has run", async () => {
  await migrationDatabase("finalization_kinds", async (subject) => {
    await finalizationKindsBefore(subject);
    await finalizationKindsSeeded(subject);
    for (const [mode, target, landing] of [
      ["Push", null, null],
      ["Push", "refs/heads/release", "Serialized"],
      ["PullRequestMerge", null, "Direct"],
      ["PullRequest", "refs/heads/main", "Serialized"],
      ["None", null, "Serialized"],
    ] as const)
      await finalizationKindsDrafted(subject, mode, target, landing);
    await postgresMigrate(subject);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT finalization_kind,finalization_mode,finalization_target,finalization_policy
             FROM draft_brief ORDER BY ticket`,
        )
      ).rows,
      [
        ["GitMerge", "Push", null, "Direct"],
        ["GitMerge", "Push", "refs/heads/release", "Serialized"],
        ["GitMerge", "PullRequestMerge", null, "Direct"],
        ["PullRequest", null, "refs/heads/main", null],
        ["None", null, null, null],
      ].map(([kind, mode, target, policy]) => ({
        finalization_kind: kind,
        finalization_mode: mode,
        finalization_target: target,
        finalization_policy: policy,
      })),
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT repository,landing_kind,landing_mode,landing_policy
             FROM project_repository ORDER BY repository`,
        )
      ).rows,
      [
        ["None", "None", null, null],
        ["PullRequest", "PullRequest", null, null],
        ["PullRequestMerge", "GitMerge", "PullRequestMerge", "Direct"],
        ["Push", "GitMerge", "Push", "Direct"],
      ].map(([repository, kind, mode, policy]) => ({
        repository,
        landing_kind: kind,
        landing_mode: mode,
        landing_policy: policy,
      })),
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT count(*)::int AS columns FROM information_schema.columns
            WHERE table_name='draft_brief' AND column_name='landing_policy'`,
        )
      ).rows,
      [{ columns: 0 }],
      "the column the policy was held in before is retired",
    );
  });
});
