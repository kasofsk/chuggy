/**
 * 212 adds a project's default theme and each person's override for a project
 * beside every row the schema already held: the default is an object or
 * none, an override names one theme, a built-in the contract lists or a theme
 * of its own person's, and both go with the theme or the project they name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration212 } from "../../src/adapters/postgres/schema/migrations/212-project-themes.ts";
import { builtInThemeIds } from "../../src/contract/appearance.ts";
import {
  deletionPartition,
  migratedBefore,
  migrationDatabase,
} from "./migrationHarness.ts";

type MigrationSubject = Parameters<Parameters<typeof migrationDatabase>[1]>[0];

/** An override of `principal`'s on the seeded project. */
function projectThemesMigrationOverride(
  subject: MigrationSubject,
  principal: string,
  builtIn: string | null,
  owned: string | null,
) {
  return subject.query(
    `INSERT INTO project_theme_override(tenant,project,principal,built_in,owned)
     VALUES('tenant-5','project-5',$1,$2,$3)`,
    [principal, builtIn, owned],
  );
}

/** Deleting `mine` takes the override naming it, and deleting the project takes both relations' rows. */
async function projectThemesMigrationCascades(
  subject: MigrationSubject,
  mine: string,
): Promise<void> {
  await projectThemesMigrationOverride(subject, "person-a", null, mine);
  await subject.query(`DELETE FROM owned_theme WHERE theme=$1`, [mine]);
  assert.deepEqual(
    (
      await subject.query(
        `SELECT principal FROM project_theme_override WHERE principal='person-a'`,
      )
    ).rows,
    [],
    "deleting a theme takes the override naming it",
  );
  await subject.query(
    `INSERT INTO project_theme(tenant,project,document,set_by_kind,set_by_subject,set_at)
     VALUES('tenant-5','project-5','{}','Member','alice',now())`,
  );
  await subject.query(
    `DELETE FROM project WHERE tenant='tenant-5' AND project='project-5'`,
  );
  for (const relation of ["project_theme", "project_theme_override"])
    assert.deepEqual(
      (await subject.query(`SELECT 1 FROM public.${relation}`)).rows,
      [],
      `${relation} goes with its project`,
    );
}

test("212 adds the relations, and an override names one theme of its own person's or a built-in the contract lists", async () => {
  await migrationDatabase("project_themes", async (subject) => {
    await migratedBefore(subject, migration212.version);
    await subject.query(deletionPartition);
    assert.equal(
      (
        await subject.query<{ found: string | null }>(
          `SELECT to_regclass('public.project_theme')::text AS found`,
        )
      ).rows[0]?.found,
      null,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration212.version));
    for (const builtIn of builtInThemeIds)
      await projectThemesMigrationOverride(
        subject,
        `person-${builtIn}`,
        builtIn,
        null,
      );
    const theme = async (principal: string) =>
      (
        await subject.query<{ theme: string }>(
          `INSERT INTO owned_theme(principal,document) VALUES($1,'{}')
           RETURNING theme::text AS theme`,
          [principal],
        )
      ).rows[0]?.theme ?? "";
    const mine = await theme("person-a");
    const theirs = await theme("person-b");
    for (const [values, constraint] of [
      [["ember", mine], "project_theme_override_names_one_theme"],
      [[null, null], "project_theme_override_names_one_theme"],
      [["neon", null], "project_theme_override_built_in_is_known"],
      [[null, theirs], "project_theme_override_owned_is_its_principals"],
    ] as const)
      await assert.rejects(
        projectThemesMigrationOverride(
          subject,
          "person-a",
          values[0],
          values[1],
        ),
        new RegExp(constraint, "u"),
        JSON.stringify(values),
      );
    await assert.rejects(
      subject.query(
        `INSERT INTO project_theme(tenant,project,document,set_by_kind,set_by_subject,set_at)
         VALUES('tenant-5','project-5','[]','Member','alice',now())`,
      ),
      /project_theme_document_is_a_bounded_object/u,
    );

    await projectThemesMigrationCascades(subject, mine);
  });
});
