/**
 * The door that keeps a binding's last import attempt: one row a binding, each
 * attempt replacing the one before unless it was recorded earlier, admitting
 * only what an attempt can be and keeping refusals only on a refusal, bounded
 * and counted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { repositoryConfigurationImportRecordFunction } from "../../src/adapters/postgres/schema.ts";
import { deletionPartition, migratedDatabase } from "./migrationHarness.ts";

/** One attempt the door is asked to keep: repository, commit, result, absence, refusals and their count. */
type ImportAttempt = readonly [
  string,
  string | null,
  string,
  string | null,
  unknown,
  number | null,
];

/** A commit an attempt read. */
const commit = "a".repeat(40);

/** One refusal an attempt keeps. */
const refusal = {
  path: ".chug/configurations/basic-coding.json",
  fault: "DocumentUnreadable",
};

/** Six refusals, one more than an attempt keeps. */
const refusals = Array.from({ length: 6 }, () => refusal);

/** One attempt written through the door, answering the refusal where it was refused. */
function recorded(
  subject: pg.Pool | pg.PoolClient,
  attempt: ImportAttempt,
): Promise<string | undefined> {
  const [repository, read, result, absent, kept, count] = attempt;
  return subject
    .query(
      `SELECT ${repositoryConfigurationImportRecordFunction}
         ('tenant-5','project-5',$1,$2,$3,$4,$5::jsonb,$6)`,
      [
        repository,
        read,
        result,
        absent,
        kept === null ? null : JSON.stringify(kept),
        count,
      ],
    )
    .then(
      () => undefined,
      (failure: unknown) => String(failure),
    );
}

/** The attempt kept of the bound repository, its time left out. */
async function kept(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT repository_commit,result,absent,refusals,refusal_count
         FROM repository_configuration_import
        WHERE tenant='tenant-5' AND project='project-5'`,
    )
  ).rows;
}

/** A project binding one repository, with no attempt of it. */
const bound = `${deletionPartition}
  INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
  VALUES('tenant-5','project-5','repository-5','epoch-5')`;

/** Every kind of attempt the door admits, each replacing the one before it. */
const admitted: readonly ImportAttempt[] = [
  ["repository-5", commit, "Imported", null, null, null],
  [
    "repository-5",
    commit,
    "SnapshotAbsent",
    "ConfigurationDirectory",
    null,
    null,
  ],
  ["repository-5", null, "SnapshotAbsent", "Commit", null, null],
  ["repository-5", null, "Unavailable", null, null, null],
  [
    "repository-5",
    commit,
    "DeclarationsRefused",
    null,
    refusals.slice(0, 5),
    6,
  ],
  ["repository-5", "b".repeat(64), "Imported", null, null, null],
];

/** Each attempt the door refuses, and the constraint it is refused by. */
const refused: readonly (readonly [ImportAttempt, RegExp])[] = [
  [["repository-5", commit, "Refused", null, null, null], /_result_is_known/u],
  [
    ["repository-5", commit, "SnapshotAbsent", "Branch", null, null],
    /_absent_is_known/u,
  ],
  [
    ["repository-5", commit, "SnapshotAbsent", null, null, null],
    /_absent_is_a_snapshots/u,
  ],
  [
    ["repository-5", commit, "Imported", "Commit", null, null],
    /_absent_is_a_snapshots/u,
  ],
  [["repository-5", null, "Imported", null, null, null], /_commit_was_read/u],
  [
    [
      "repository-5",
      null,
      "SnapshotAbsent",
      "ConfigurationDirectory",
      null,
      null,
    ],
    /_commit_was_read/u,
  ],
  [
    ["repository-5", "main", "Imported", null, null, null],
    /_commit_is_git_object/u,
  ],
  [
    ["repository-5", "a".repeat(41), "Imported", null, null, null],
    /_commit_is_git_object/u,
  ],
  [
    ["repository-5", `x${commit}`, "Imported", null, null, null],
    /_commit_is_git_object/u,
  ],
  [
    ["unbound-5", commit, "Imported", null, null, null],
    /_repository_is_bound/u,
  ],
  [
    ["repository-5", commit, "Imported", null, [refusal], 1],
    /_refusals_are_a_refused_imports/u,
  ],
  [
    ["repository-5", commit, "DeclarationsRefused", null, [refusal], null],
    /_refusals_are_counted/u,
  ],
  [
    ["repository-5", commit, "DeclarationsRefused", null, null, 1],
    /_refusals_are_counted/u,
  ],
  [
    ["repository-5", commit, "DeclarationsRefused", null, refusals, 6],
    /_refusals_are_bounded/u,
  ],
  [
    ["repository-5", commit, "DeclarationsRefused", null, [], 1],
    /_refusals_are_bounded/u,
  ],
  [
    [
      "repository-5",
      commit,
      "DeclarationsRefused",
      null,
      [refusal, refusal],
      1,
    ],
    /_refusals_are_bounded/u,
  ],
  [
    ["repository-5", commit, "DeclarationsRefused", null, refusal, 1],
    /_refusals_are_bounded/u,
  ],
];

test("a binding keeps one attempt, each replacing the one before, and only what an attempt can be", async () => {
  await migratedDatabase("import_attempt_rows", async (subject) => {
    await subject.query(bound);
    for (const attempt of admitted) {
      assert.equal(await recorded(subject, attempt), undefined);
      assert.deepEqual(await kept(subject), [
        {
          repository_commit: attempt[1],
          result: attempt[2],
          absent: attempt[3],
          refusals: attempt[4],
          refusal_count: attempt[5],
        },
      ]);
    }
    for (const [attempt, constraint] of refused)
      assert.match(
        String(await recorded(subject, attempt)),
        constraint,
        JSON.stringify(attempt),
      );
  });
});

/**
 * The door's clock is its transaction's, so of two recordings racing, the one
 * whose transaction began first is the earlier, and finds the later one kept.
 */
test("an attempt is never replaced with one recorded before it", async () => {
  await migratedDatabase("import_attempt_order", async (subject) => {
    await subject.query(bound);
    const earlier = await subject.connect();
    try {
      await earlier.query("BEGIN");
      await earlier.query("SELECT now()");
      assert.equal(
        await recorded(subject, [
          "repository-5",
          commit,
          "Imported",
          null,
          null,
          null,
        ]),
        undefined,
      );
      assert.equal(
        await recorded(earlier, [
          "repository-5",
          "b".repeat(40),
          "StaleBinding",
          null,
          null,
          null,
        ]),
        undefined,
      );
      await earlier.query("COMMIT");
    } finally {
      earlier.release();
    }
    assert.deepEqual(await kept(subject), [
      {
        repository_commit: commit,
        result: "Imported",
        absent: null,
        refusals: null,
        refusal_count: null,
      },
    ]);
  });
});
