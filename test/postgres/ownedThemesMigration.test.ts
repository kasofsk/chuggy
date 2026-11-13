/**
 * 174 adds a person's own themes and their global choice beside every row the
 * schema already held, and the relations it adds refuse a choice that names
 * two themes, none, a built-in off the contract's roster, or a theme of
 * another person's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration174 } from "../../src/adapters/postgres/schema/migrations/174-owned-themes.ts";
import { builtInThemeIds } from "../../src/contract/appearance.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** A theme `principal` owns, by the number the relation gave it. */
async function ownedThemesMigrationTheme(
  subject: pg.Pool,
  principal: string,
): Promise<string> {
  const found = await subject.query<{ theme: string }>(
    `INSERT INTO owned_theme(principal,document) VALUES($1,'{}')
     RETURNING theme::text AS theme`,
    [principal],
  );
  return found.rows[0]?.theme ?? "";
}

test("174 adds the relations, and a choice names one theme of its own person's or a built-in the contract lists", async () => {
  await migrationDatabase("owned_themes", async (subject) => {
    await migratedBefore(subject, migration174.version);
    assert.equal(
      (
        await subject.query<{ found: string | null }>(
          `SELECT to_regclass('public.owned_theme')::text AS found`,
        )
      ).rows[0]?.found,
      null,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration174.version));
    for (const builtIn of builtInThemeIds)
      await subject.query(
        `INSERT INTO theme_choice(principal,built_in) VALUES($1,$2)`,
        [`person-${builtIn}`, builtIn],
      );
    const mine = await ownedThemesMigrationTheme(subject, "person-a");
    const theirs = await ownedThemesMigrationTheme(subject, "person-b");
    assert.notEqual(mine, theirs);
    for (const [values, constraint] of [
      [["person-a", "ember", mine], "theme_choice_names_one_theme"],
      [["person-a", null, null], "theme_choice_names_one_theme"],
      [["person-a", "neon", null], "theme_choice_built_in_is_known"],
      [["person-a", null, theirs], "theme_choice_owned_is_its_principals"],
    ] as const)
      await assert.rejects(
        subject.query(
          `INSERT INTO theme_choice(principal,built_in,owned) VALUES($1,$2,$3)`,
          [...values],
        ),
        new RegExp(constraint, "u"),
        JSON.stringify(values),
      );
    await assert.rejects(
      subject.query(
        `INSERT INTO owned_theme(principal,document) VALUES('person-a','[]')`,
      ),
      /owned_theme_document_is_a_bounded_object/u,
    );

    await subject.query(
      `INSERT INTO theme_choice(principal,owned) VALUES('person-a',$1)`,
      [mine],
    );
    await subject.query(`DELETE FROM owned_theme WHERE theme=$1`, [mine]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT principal FROM theme_choice WHERE principal='person-a'`,
        )
      ).rows,
      [],
      "deleting a theme takes the choice naming it",
    );
  });
});
