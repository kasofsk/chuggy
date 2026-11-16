/**
 * A project's appearance as its routes answer it, over the service the API
 * composes: the project's default read by a reader and written whole or
 * cleared by an administrator alone, the caller's own override, the resolved
 * read, and every body refused that carries a field its schema does not name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { builtInThemes } from "../../src/contract/appearance.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  projectAppearanceResponseSchema,
  projectThemeResponseSchema,
  themeChoiceResponseSchema,
} from "../../src/contract/responses.ts";
import {
  administrator,
  projectAppearanceFixture,
  projectDocument,
  reader,
  stranger,
} from "../interpreter/projectAppearanceFixture.ts";
import { callerApp } from "./callerAppFixture.ts";

const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };

const atlasPath = (route: string) =>
  route.replace(":tenant", "acme").replace(":project", "atlas");
const themePath = atlasPath(nativeHttpRoutes.projectTheme);
const overridePath = atlasPath(nativeHttpRoutes.projectThemeOverride);
const appearancePath = atlasPath(nativeHttpRoutes.projectAppearance);

function codeOf(answer: { json<T>(): T }): string {
  return answer.json<{ error: { code: string } }>().error.code;
}

function sent(
  app: ReturnType<typeof callerApp>,
  method: "PUT" | "DELETE",
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: body === undefined ? bearer : { ...bearer, ...json },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

test("an administrator sets the project's default document and clears it, each answer the default as it now stands", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(administrator, { projectAppearance: service });
  const set = await sent(app, "PUT", themePath, { document: projectDocument });
  assert.equal(set.statusCode, 200);
  assert.deepEqual(projectThemeResponseSchema.parse(set.json()), {
    document: projectDocument,
    administers: true,
  });
  const read = await app.inject({ url: themePath, headers: bearer });
  assert.deepEqual(read.json(), {
    document: projectDocument,
    administers: true,
  });
  const cleared = await sent(app, "PUT", themePath, {});
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.json(), { administers: true });
  assert.equal(held.projectDefault, undefined);
});

test("a member without administer reads the project's default and is refused writing it", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(reader, { projectAppearance: service });
  held.projectDefault = projectDocument;
  const read = await app.inject({ url: themePath, headers: bearer });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), {
    document: projectDocument,
    administers: false,
  });
  for (const body of [{ document: builtInThemes.harbour }, {}]) {
    const written = await sent(app, "PUT", themePath, body);
    assert.equal(written.statusCode, 404);
  }
  assert.deepEqual(held.writes, []);
  assert.deepEqual(held.projectDefault, projectDocument);
});

test("a caller who may not read the project is told none of its routes is there", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(stranger, { projectAppearance: service });
  for (const url of [themePath, overridePath, appearancePath])
    assert.equal(
      (await app.inject({ url, headers: bearer })).statusCode,
      404,
      url,
    );
  assert.equal(
    (await sent(app, "PUT", overridePath, { kind: "BuiltIn", theme: "ember" }))
      .statusCode,
    404,
  );
  assert.equal((await sent(app, "DELETE", overridePath)).statusCode, 404);
  assert.deepEqual(held.writes, []);
});

test("a reader sets, reads and clears their own override, and the resolved read wears it above the project's default", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(reader, { projectAppearance: service });
  held.projectDefault = projectDocument;
  held.overrides.set(administrator, { kind: "BuiltIn", theme: "harbour" });
  const before = await app.inject({ url: appearancePath, headers: bearer });
  assert.deepEqual(projectAppearanceResponseSchema.parse(before.json()), {
    theme: projectDocument,
    layer: "ProjectDefault",
    layers: { projectDefault: projectDocument },
  });
  const chosen = await sent(app, "PUT", overridePath, {
    kind: "BuiltIn",
    theme: "high-contrast",
  });
  assert.equal(chosen.statusCode, 204);
  const read = await app.inject({ url: overridePath, headers: bearer });
  assert.deepEqual(themeChoiceResponseSchema.parse(read.json()), {
    choice: { kind: "BuiltIn", theme: "high-contrast" },
  });
  const after = await app.inject({ url: appearancePath, headers: bearer });
  assert.deepEqual(after.json(), {
    theme: builtInThemes["high-contrast"],
    layer: "ProjectOverride",
    layers: {
      override: { kind: "BuiltIn", theme: "high-contrast" },
      projectDefault: projectDocument,
    },
  });
  assert.equal((await sent(app, "DELETE", overridePath)).statusCode, 204);
  assert.deepEqual(
    (await app.inject({ url: overridePath, headers: bearer })).json(),
    {},
  );
  assert.deepEqual(held.overrides.get(administrator), {
    kind: "BuiltIn",
    theme: "harbour",
  });
});

test("an override naming a theme that is not the caller's is refused ThemeNotFound", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(reader, { projectAppearance: service });
  held.owned.set(administrator, new Map([[9, projectDocument]]));
  const refused = await sent(app, "PUT", overridePath, {
    kind: "Owned",
    theme: 9,
  });
  assert.equal(refused.statusCode, 422);
  assert.equal(codeOf(refused), "ThemeNotFound");
  assert.equal(held.overrides.has(reader), false);
});

test("every body carrying a field its schema does not name is refused and writes nothing", async () => {
  const { held, service } = projectAppearanceFixture();
  await using app = callerApp(administrator, { projectAppearance: service });
  for (const [url, body] of [
    [themePath, { document: projectDocument, extra: true }],
    [themePath, { document: { ...projectDocument, extra: true } }],
    [overridePath, { kind: "BuiltIn", theme: "ember", extra: true }],
    [overridePath, { kind: "BuiltIn", theme: "neon" }],
  ] as const) {
    const answer = await sent(app, "PUT", url, body);
    assert.equal(answer.statusCode, 400, JSON.stringify(body));
    assert.equal(codeOf(answer), "InvalidRequest");
  }
  assert.deepEqual(held.writes, []);
});

test("the response schemas refuse a field they do not name", () => {
  for (const [schema, answer] of [
    [projectThemeResponseSchema, { administers: true, extra: 1 }],
    [
      projectAppearanceResponseSchema,
      {
        theme: projectDocument,
        layer: "ProjectDefault",
        layers: { projectDefault: projectDocument, extra: 1 },
      },
    ],
  ] as const)
    assert.equal(schema.safeParse(answer).success, false);
});
