/**
 * 142 replaces the installation's default lead prompt where it is still the
 * baseline's text, at the revision it stood at, and leaves an owner's default
 * as they wrote it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { postgresSelectorRuntimeControl } from "../../src/adapters/postgres/selector.ts";
import {
  leadBasePromptAt142,
  leadBasePromptAtBaseline,
  migration142,
} from "../../src/adapters/postgres/schema/migrations/142-lead-prompt-default.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

const administrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("installation-owner"),
};

async function leadPromptDefaultRows(subject: pg.Pool): Promise<{
  readonly settings: readonly unknown[];
  readonly history: readonly unknown[];
}> {
  const settings = await subject.query(
    `SELECT revision::int,base_prompt FROM selector_runtime_settings`,
  );
  const history = await subject.query(
    `SELECT revision::int,base_prompt FROM selector_runtime_settings_history
      ORDER BY revision`,
  );
  return { settings: settings.rows, history: history.rows };
}

test("142 gives an installation on the baseline's default the new one, at the revision it stood at", async () => {
  await migrationDatabase("lead_prompt_baseline", async (subject) => {
    await migratedBefore(subject, migration142.version);
    assert.deepEqual(await leadPromptDefaultRows(subject), {
      settings: [{ revision: 1, base_prompt: leadBasePromptAtBaseline }],
      history: [{ revision: 1, base_prompt: leadBasePromptAtBaseline }],
    });

    assert.ok((await postgresMigrate(subject)).includes(migration142.version));
    assert.deepEqual(await leadPromptDefaultRows(subject), {
      settings: [{ revision: 1, base_prompt: leadBasePromptAt142 }],
      history: [{ revision: 1, base_prompt: leadBasePromptAt142 }],
    });
  });
});

test("142 leaves a default an owner wrote as they wrote it", async () => {
  await migrationDatabase("lead_prompt_owned", async (subject) => {
    await migratedBefore(subject, migration142.version);
    const owned = "Dispatch what the owner has marked urgent first.";
    await postgresSelectorRuntimeControl(subject).updateBasePrompt(
      1,
      owned,
      administrator,
    );

    const ownedRows = async (): Promise<readonly unknown[]> =>
      (
        await subject.query<{
          kept: string;
          revision: number;
          base_prompt: string;
        }>(
          `SELECT 'settings' AS kept,revision::int,base_prompt
             FROM selector_runtime_settings
           UNION ALL
           SELECT 'history',revision::int,base_prompt
             FROM selector_runtime_settings_history WHERE revision=2
           ORDER BY kept`,
        )
      ).rows;
    const before = await ownedRows();
    assert.deepEqual(before, [
      { kept: "history", revision: 2, base_prompt: owned },
      { kept: "settings", revision: 2, base_prompt: owned },
    ]);

    await postgresMigrate(subject);
    assert.deepEqual(await ownedRows(), before);
  });
});
