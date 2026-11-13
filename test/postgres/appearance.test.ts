/**
 * A person's own themes and global choice as the API keeps them, against a
 * real server and under the API's role: created, listed, read, written whole
 * and deleted, held to the bound under a race, never reached by another
 * person, and a choice set, cleared and left as none by deleting its theme.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresAppearance } from "../../src/adapters/postgres/appearance.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import {
  builtInThemeIds,
  builtInThemes,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessRolePool,
} from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await harness.close();
});

const appearance = postgresAppearance(apiPool);

function member(): Principal {
  return asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
}

const first: ThemeDocument = { ...builtInThemes.harbour, name: "First" };
const second: ThemeDocument = { ...builtInThemes.ember, name: "Second" };

/** A theme `principal` owns, by the number the store gave it. */
async function created(
  principal: Principal,
  document: ThemeDocument,
): Promise<number> {
  const theme = await appearance.create(principal, document, 8);
  assert.ok(theme !== undefined, "the theme was created");
  return theme;
}

test("a person creates, lists, reads, writes and deletes their own themes, each by a number never given twice", async () => {
  const owner = member();
  const one = await created(owner, first);
  const two = await created(owner, second);
  assert.ok(two > one);
  assert.deepEqual(await appearance.themes(owner), [
    { theme: one, document: first },
    { theme: two, document: second },
  ]);
  const renamed = { ...first, name: "First, renamed", font: "Serif" } as const;
  assert.equal(await appearance.write(owner, one, renamed), true);
  assert.deepEqual(await appearance.theme(owner, one), {
    theme: one,
    document: renamed,
  });
  assert.equal(await appearance.delete(owner, one), true);
  assert.equal(await appearance.theme(owner, one), undefined);
  assert.equal(await appearance.delete(owner, one), false);
  assert.equal(await appearance.write(owner, one, first), false);
  const three = await created(owner, first);
  assert.ok(three > two, "a deleted theme's number is not given again");
  assert.deepEqual(
    (await appearance.themes(owner)).map((theme) => theme.theme),
    [two, three],
  );
});

test("a creation past the bound keeps nothing, and of creations racing for the last place one is kept", async () => {
  const owner = member();
  await created(owner, first);
  await created(owner, first);
  assert.equal(await appearance.create(owner, first, 2), undefined);
  const racing = await Promise.all(
    Array.from({ length: 6 }, () => appearance.create(owner, second, 3)),
  );
  assert.equal(racing.filter((theme) => theme !== undefined).length, 1);
  assert.equal((await appearance.themes(owner)).length, 3);
});

test("no person reads, writes, deletes or chooses another's theme, and neither's choice moves the other's", async () => {
  const owner = member();
  const other = member();
  const theme = await created(owner, first);
  assert.deepEqual(await appearance.themes(other), []);
  assert.equal(await appearance.theme(other, theme), undefined);
  assert.equal(await appearance.write(other, theme, second), false);
  assert.equal(await appearance.delete(other, theme), false);
  assert.equal(
    await appearance.choose(other, { kind: "Owned", theme }),
    false,
    "a choice naming another's theme is refused",
  );
  assert.equal(await appearance.choice(other), undefined);
  assert.equal(
    await appearance.choose(other, { kind: "BuiltIn", theme: "ember" }),
    true,
  );
  assert.equal(await appearance.choice(owner), undefined);
  assert.deepEqual(await appearance.theme(owner, theme), {
    theme,
    document: first,
  });
});

test("a choice is set to each built-in or a theme of the person's own, cleared, and reads as none once its theme is deleted", async () => {
  const owner = member();
  assert.equal(await appearance.choice(owner), undefined);
  for (const builtIn of builtInThemeIds) {
    assert.equal(
      await appearance.choose(owner, { kind: "BuiltIn", theme: builtIn }),
      true,
    );
    assert.deepEqual(await appearance.choice(owner), {
      kind: "BuiltIn",
      theme: builtIn,
    });
  }
  assert.equal(await appearance.choose(owner, undefined), true);
  assert.equal(await appearance.choice(owner), undefined);
  assert.equal(await appearance.choose(owner, undefined), true);

  const theme = await created(owner, first);
  const kept = await created(owner, second);
  assert.equal(await appearance.choose(owner, { kind: "Owned", theme }), true);
  assert.deepEqual(await appearance.choice(owner), { kind: "Owned", theme });
  assert.equal(await appearance.delete(owner, kept), true);
  assert.deepEqual(
    await appearance.choice(owner),
    { kind: "Owned", theme },
    "deleting another theme leaves the choice",
  );
  assert.equal(await appearance.delete(owner, theme), true);
  assert.equal(await appearance.choice(owner), undefined);
  assert.equal(
    await appearance.choose(owner, { kind: "Owned", theme }),
    false,
    "a deleted theme cannot be chosen",
  );
});

test("the API reaches either relation through its doors alone", async () => {
  for (const [statement, relation] of [
    ["SELECT * FROM owned_theme", "owned_theme"],
    ["SELECT * FROM theme_choice", "theme_choice"],
    [
      "INSERT INTO theme_choice(principal,built_in) VALUES('p','ember')",
      "theme_choice",
    ],
  ] as const)
    assert.match(
      (await harness.attemptAs(apiRole, statement)) ?? "",
      postgresHarnessDenial(relation),
      statement,
    );
});
