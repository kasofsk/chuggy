/**
 * 218 adds a project's images beside every row the schema already held: a row
 * names one role the contract lists, an artifact or none, and goes with the
 * project it names.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration218 } from "../../src/adapters/postgres/schema/migrations/218-project-images.ts";
import { projectImageRoles } from "../../src/contract/http.ts";
import {
  deletionPartition,
  migratedBefore,
  migrationDatabase,
} from "./migrationHarness.ts";

type MigrationSubject = Parameters<Parameters<typeof migrationDatabase>[1]>[0];

/** A row naming `artifact` in `role` of the seeded project. */
function projectImagesMigrationRow(
  subject: MigrationSubject,
  role: string,
  artifact: string | null,
) {
  return subject.query(
    `INSERT INTO project_image(tenant,project,role,artifact,set_by_kind,set_by_subject,set_at)
     VALUES('tenant-5','project-5',$1,$2,'Member','alice',now())`,
    [role, artifact],
  );
}

test("218 adds the relation, a row names a role the contract lists, and it goes with its project", async () => {
  await migrationDatabase("project_images", async (subject) => {
    await migratedBefore(subject, migration218.version);
    await subject.query(deletionPartition);
    assert.equal(
      (
        await subject.query<{ found: string | null }>(
          `SELECT to_regclass('public.project_image')::text AS found`,
        )
      ).rows[0]?.found,
      null,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration218.version));
    for (const role of projectImageRoles)
      await projectImagesMigrationRow(subject, role, null);
    for (const [role, artifact, constraint] of [
      ["favicon", "image/png:t", "project_image_role_is_known"],
      ["icon", "", "project_image_artifact_is_bounded"],
      ["icon", "a".repeat(257), "project_image_artifact_is_bounded"],
    ] as const)
      await assert.rejects(
        subject.query(
          `UPDATE project_image SET role=$1,artifact=$2
            WHERE tenant='tenant-5' AND project='project-5' AND role='icon'`,
          [role, artifact],
        ),
        new RegExp(constraint, "u"),
        role,
      );

    await subject.query(
      `DELETE FROM project WHERE tenant='tenant-5' AND project='project-5'`,
    );
    assert.deepEqual(
      (await subject.query(`SELECT 1 FROM public.project_image`)).rows,
      [],
      "project_image goes with its project",
    );
  });
});
