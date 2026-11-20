/**
 * A project's appearance as the API keeps it, against a real server and under
 * the API's role: the project's default document written, repeated, cleared
 * and kept with who set it; each person's override set to a built-in or a
 * theme of their own, never another's, and none once its theme is deleted, so
 * the resolved read falls to the layer below; and the API writing neither
 * relation but through its doors, and reading the default's row directly.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresAppearance } from "../../src/adapters/postgres/appearance.ts";
import { postgresProjectAppearance } from "../../src/adapters/postgres/projectAppearance.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import {
  builtInThemes,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { projectAppearanceService } from "../../src/interpreter/projectAppearance.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
} from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await harness.close();
});

const themes = postgresProjectAppearance(apiPool);
const appearance = postgresAppearance(apiPool);

/** Every caller may read and administer every project: the permits are the service's, and its own suite holds them. */
const service = projectAppearanceService(
  {
    authorize: (principal) => Promise.resolve(memberAuthority(principal)),
    authorizeTenant: () => Promise.resolve(undefined),
    authorizeSite: projectAccessSiteRefused,
  },
  themes,
  appearance,
);

const setter = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("alice"),
};

const projectDocument: ThemeDocument = {
  ...builtInThemes.ember,
  name: "Project",
};
const mine: ThemeDocument = { ...builtInThemes.harbour, name: "Mine" };

function member(): Principal {
  return asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
}

function project(): Promise<Partition> {
  return postgresHarnessProject(harness.store, `themed-${randomUUID()}`);
}

/** A theme `principal` owns, by the number the store gave it. */
async function owned(principal: Principal): Promise<number> {
  const theme = await appearance.create(principal, mine, 8);
  assert.ok(theme !== undefined, "the theme was created");
  return theme;
}

test("a project's default document is written, repeated as Unchanged, cleared, and kept with who set it", async () => {
  const partition = await project();
  assert.equal(await themes.projectTheme(partition), undefined);
  assert.equal(
    await themes.writeProjectTheme(partition, undefined, setter),
    "Unchanged",
    "clearing a default never set moves nothing",
  );
  assert.equal(
    await themes.writeProjectTheme(partition, projectDocument, setter),
    "Written",
  );
  assert.deepEqual(await themes.projectTheme(partition), projectDocument);
  assert.equal(
    await themes.writeProjectTheme(
      partition,
      { ...projectDocument, font: projectDocument.font },
      setter,
    ),
    "Unchanged",
  );
  const kept = await harness.query(
    `SELECT set_by_kind,set_by_subject FROM project_theme
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(kept, [{ set_by_kind: "Member", set_by_subject: "alice" }]);
  assert.equal(
    await themes.writeProjectTheme(partition, undefined, setter),
    "Written",
  );
  assert.equal(await themes.projectTheme(partition), undefined);
  assert.equal(
    await themes.writeProjectTheme(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      projectDocument,
      setter,
    ),
    "NotFound",
  );
});

test("the project's default is the document itself, unmoved when the theme it was copied from is edited or deleted", async () => {
  const partition = await project();
  const author = member();
  const theme = await owned(author);
  assert.equal(
    await themes.writeProjectTheme(partition, mine, setter),
    "Written",
  );
  assert.equal(
    await appearance.write(author, theme, { ...mine, name: "Edited" }),
    true,
  );
  assert.equal(await appearance.delete(author, theme), true);
  assert.deepEqual(await themes.projectTheme(partition), mine);
});

test("a person's override is set to a built-in or a theme of their own, never another's, and moves no other person's", async () => {
  const partition = await project();
  const person = member();
  const other = member();
  const theirs = await owned(other);
  assert.equal(
    await themes.writeOverride(partition, person, {
      kind: "BuiltIn",
      theme: "ember",
    }),
    "Chosen",
  );
  assert.equal(
    await themes.writeOverride(partition, person, {
      kind: "Owned",
      theme: theirs,
    }),
    "ThemeNotFound",
  );
  assert.deepEqual(await themes.override(partition, person), {
    kind: "BuiltIn",
    theme: "ember",
  });
  assert.equal(await themes.override(partition, other), undefined);
  const theme = await owned(person);
  assert.equal(
    await themes.writeOverride(partition, person, { kind: "Owned", theme }),
    "Chosen",
  );
  assert.deepEqual(await themes.override(partition, person), {
    kind: "Owned",
    theme,
  });
  assert.equal(
    await themes.writeOverride(partition, person, undefined),
    "Chosen",
  );
  assert.equal(await themes.override(partition, person), undefined);
  assert.equal(
    await themes.writeOverride(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      person,
      { kind: "BuiltIn", theme: "ember" },
    ),
    "NotFound",
  );
});

test("the resolved read takes each layer in turn, and an override whose theme is deleted falls to the layer below", async () => {
  const partition = await project();
  const person = member();
  const resolved = async () => {
    const read = await service.resolved(person, partition);
    assert.equal(read.result, "Found");
    return read.view;
  };
  assert.equal((await resolved()).layer, "BuiltInDefault");
  assert.equal(
    await appearance.choose(person, { kind: "BuiltIn", theme: "harbour" }),
    true,
  );
  assert.deepEqual(
    { ...(await resolved()), layers: undefined },
    { theme: builtInThemes.harbour, layer: "Global", layers: undefined },
  );
  assert.equal(
    await themes.writeProjectTheme(partition, projectDocument, setter),
    "Written",
  );
  assert.equal((await resolved()).layer, "ProjectDefault");
  const theme = await owned(person);
  assert.equal(
    await themes.writeOverride(partition, person, { kind: "Owned", theme }),
    "Chosen",
  );
  assert.deepEqual(await resolved(), {
    theme: mine,
    layer: "ProjectOverride",
    layers: {
      override: { kind: "Owned", theme },
      projectDefault: projectDocument,
      global: { kind: "BuiltIn", theme: "harbour" },
    },
  });
  assert.equal(await appearance.delete(person, theme), true);
  assert.deepEqual(await resolved(), {
    theme: projectDocument,
    layer: "ProjectDefault",
    layers: {
      override: undefined,
      projectDefault: projectDocument,
      global: { kind: "BuiltIn", theme: "harbour" },
    },
  });
});

test("the API reads the project's default and reaches each override through its doors alone", async () => {
  for (const [statement, relation] of [
    ["SELECT * FROM project_theme_override", "project_theme_override"],
    [
      "INSERT INTO project_theme(tenant,project,set_by_kind,set_by_subject,set_at) VALUES('t','p','k','s',now())",
      "project_theme",
    ],
    ["UPDATE project_theme SET document=NULL", "project_theme"],
  ] as const)
    assert.match(
      (await harness.attemptAs(apiRole, statement)) ?? "",
      postgresHarnessDenial(relation),
      statement,
    );
  assert.equal(
    await harness.attemptAs(apiRole, "SELECT document FROM project_theme"),
    undefined,
  );
});
