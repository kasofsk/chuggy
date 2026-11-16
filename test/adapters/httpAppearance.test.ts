/**
 * A person's own themes and global choice as their routes answer them: each
 * body as its response schema has it, every route handed the caller's own
 * principal, and each refusal by its code: a document failing its schema, one
 * failing the contrast rule, a creation past the bound, a number none of the
 * caller's, and a choice naming a theme none of theirs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  builtInThemes,
  themesOwnedMax,
  type ThemeChoice,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  ownedThemeSchema,
  ownedThemesResponseSchema,
  themeChoiceResponseSchema,
} from "../../src/contract/responses.ts";
import {
  appearanceService,
  type AppearanceStore,
  type OwnedTheme,
} from "../../src/interpreter/appearance.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { callerApp } from "./callerAppFixture.ts";

const caller = asPrincipal("issuer-subject");

/** Ember's palette, which carries both schemes. */
const emberPalette = (() => {
  const palette = builtInThemes.ember.palette;
  assert.equal(palette.schemes, "Both");
  return palette;
})();
const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };

const passing: ThemeDocument = { ...builtInThemes.ember, name: "Mine" };

const faint: ThemeDocument = {
  ...passing,
  palette: {
    schemes: "Dark",
    dark: {
      ...emberPalette.dark,
      "ink-1": emberPalette.dark["surface-0"],
    },
  },
};

/** A store keeping each principal's themes and choice apart in memory, recording which principal each call named. */
function memoryStore(principals: string[]): AppearanceStore {
  const themes = new Map<number, OwnedTheme & { readonly owner: string }>();
  const choices = new Map<string, ThemeChoice>();
  let next = 1;
  const own = (principal: string) =>
    [...themes.values()].filter((theme) => theme.owner === principal);
  return {
    themes: (principal) => {
      principals.push(principal);
      return Promise.resolve(
        own(principal).map(({ theme, document }) => ({ theme, document })),
      );
    },
    theme: (principal, theme) => {
      principals.push(principal);
      const found = themes.get(theme);
      return Promise.resolve(
        found?.owner === principal
          ? { theme, document: found.document }
          : undefined,
      );
    },
    create: (principal, document, themesMax) => {
      principals.push(principal);
      if (own(principal).length >= themesMax) return Promise.resolve(undefined);
      const theme = next++;
      themes.set(theme, { theme, document, owner: principal });
      return Promise.resolve(theme);
    },
    write: (principal, theme, document) => {
      principals.push(principal);
      if (themes.get(theme)?.owner !== principal) return Promise.resolve(false);
      themes.set(theme, { theme, document, owner: principal });
      return Promise.resolve(true);
    },
    delete: (principal, theme) => {
      principals.push(principal);
      if (themes.get(theme)?.owner !== principal) return Promise.resolve(false);
      themes.delete(theme);
      const chosen = choices.get(principal);
      if (chosen?.kind === "Owned" && chosen.theme === theme)
        choices.delete(principal);
      return Promise.resolve(true);
    },
    choice: (principal) => {
      principals.push(principal);
      return Promise.resolve(choices.get(principal));
    },
    choose: (principal, choice) => {
      principals.push(principal);
      if (choice === undefined) choices.delete(principal);
      else if (
        choice.kind === "Owned" &&
        themes.get(choice.theme)?.owner !== principal
      )
        return Promise.resolve(false);
      else choices.set(principal, choice);
      return Promise.resolve(true);
    },
  };
}

function appearanceApp(principals: string[]) {
  return callerApp(caller, {
    appearance: appearanceService(memoryStore(principals)),
  });
}

const themePath = (theme: number | string) =>
  nativeHttpRoutes.ownTheme.replace(":theme", String(theme));

type AppearanceApp = ReturnType<typeof appearanceApp>;

function sent(
  app: AppearanceApp,
  method: "POST" | "PUT",
  url: string,
  body: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...bearer, ...json },
    payload: JSON.stringify(body),
  });
}

function codeOf(answer: { json(): unknown }): string {
  return (answer.json() as { error: { code: string } }).error.code;
}

test("the caller creates, lists, reads, renames, edits and deletes a theme of their own, each body as its schema has it", async () => {
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  const created = await sent(app, "POST", nativeHttpRoutes.ownThemes, passing);
  assert.equal(created.statusCode, 201);
  const { theme } = ownedThemeSchema.parse(created.json());
  assert.deepEqual(created.json(), { theme, document: passing });

  const renamed = { ...passing, name: "Mine, renamed" };
  assert.equal(
    (await sent(app, "PUT", themePath(theme), renamed)).statusCode,
    204,
  );
  const edited = { ...renamed, textSize: "Larger", font: "Serif" } as const;
  assert.equal(
    (await sent(app, "PUT", themePath(theme), edited)).statusCode,
    204,
  );
  const read = await app.inject({ url: themePath(theme), headers: bearer });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(ownedThemeSchema.parse(read.json()), {
    theme,
    document: edited,
  });
  const listed = await app.inject({
    url: nativeHttpRoutes.ownThemes,
    headers: bearer,
  });
  assert.deepEqual(ownedThemesResponseSchema.parse(listed.json()), {
    themes: [{ theme, document: edited }],
  });

  const deleted = await app.inject({
    method: "DELETE",
    url: themePath(theme),
    headers: bearer,
  });
  assert.equal(deleted.statusCode, 204);
  for (const gone of [
    await app.inject({ url: themePath(theme), headers: bearer }),
    await app.inject({
      method: "DELETE",
      url: themePath(theme),
      headers: bearer,
    }),
    await sent(app, "PUT", themePath(theme), passing),
  ])
    assert.equal(gone.statusCode, 404);
  assert.deepEqual(
    (
      await app.inject({ url: nativeHttpRoutes.ownThemes, headers: bearer })
    ).json(),
    { themes: [] },
  );
  assert.ok(principals.length > 0);
  assert.ok(
    principals.every((principal) => principal === caller),
    "every call named the caller's own principal",
  );
});

test("a document failing its schema is refused InvalidRequest, and one failing the contrast rule ThemeContrastInsufficient, with nothing kept", async () => {
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  const kept = ownedThemeSchema.parse(
    (await sent(app, "POST", nativeHttpRoutes.ownThemes, passing)).json(),
  ).theme;
  const light = emberPalette.light;
  for (const refused of [
    { ...passing, name: " " },
    { ...passing, name: "x".repeat(81) },
    { ...passing, textSize: "Huge" },
    { ...passing, owner: "someone-else" },
    {
      ...passing,
      palette: { schemes: "Light", light: { ...light, accent: "#ABCDEF" } },
    },
    {
      ...passing,
      palette: {
        schemes: "Light",
        light: { ...light, "tone-pass": "#000000" },
      },
    },
    { ...passing, palette: { schemes: "Both", light } },
  ])
    for (const answer of [
      await sent(app, "POST", nativeHttpRoutes.ownThemes, refused),
      await sent(app, "PUT", themePath(kept), refused),
    ]) {
      assert.equal(answer.statusCode, 400, JSON.stringify(refused));
      assert.equal(codeOf(answer), "InvalidRequest");
    }
  for (const answer of [
    await sent(app, "POST", nativeHttpRoutes.ownThemes, faint),
    await sent(app, "PUT", themePath(kept), faint),
  ]) {
    assert.equal(answer.statusCode, 422);
    assert.equal(codeOf(answer), "ThemeContrastInsufficient");
    assert.match(
      answer.json<{ error: { message: string } }>().error.message,
      /ink-1 on surface-0 in Dark is 1\.00, under 4\.5/u,
    );
  }
  assert.deepEqual(
    (
      await app.inject({ url: nativeHttpRoutes.ownThemes, headers: bearer })
    ).json(),
    { themes: [{ theme: kept, document: passing }] },
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: nativeHttpRoutes.ownThemes,
        headers: bearer,
        payload: JSON.stringify(passing),
      })
    ).statusCode,
    415,
  );
});

test("a creation past the caller's bound is refused ThemeLimitReached, and a deletion makes room again", async () => {
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  const numbers: number[] = [];
  for (let made = 0; made < themesOwnedMax; made++) {
    const created = await sent(
      app,
      "POST",
      nativeHttpRoutes.ownThemes,
      passing,
    );
    assert.equal(created.statusCode, 201);
    numbers.push(ownedThemeSchema.parse(created.json()).theme);
  }
  const refused = await sent(app, "POST", nativeHttpRoutes.ownThemes, passing);
  assert.equal(refused.statusCode, 409);
  assert.equal(codeOf(refused), "ThemeLimitReached");
  await app.inject({
    method: "DELETE",
    url: themePath(numbers[0] ?? 0),
    headers: bearer,
  });
  assert.equal(
    (await sent(app, "POST", nativeHttpRoutes.ownThemes, passing)).statusCode,
    201,
  );
});

test("a theme number that is not a positive whole number is refused before the service", async () => {
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  for (const theme of ["0", "-1", "01", "1.5", "x"])
    assert.equal(
      (await app.inject({ url: themePath(theme), headers: bearer })).statusCode,
      400,
      theme,
    );
  assert.deepEqual(principals, []);
});

test("the caller's global choice is set to a built-in or a theme of theirs, cleared, and left as none by deleting the theme it names", async () => {
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  const choice = async () =>
    themeChoiceResponseSchema.parse(
      (
        await app.inject({ url: nativeHttpRoutes.themeChoice, headers: bearer })
      ).json(),
    );
  assert.deepEqual(await choice(), {});

  const builtIn = { kind: "BuiltIn", theme: "high-contrast" } as const;
  assert.equal(
    (await sent(app, "PUT", nativeHttpRoutes.themeChoice, builtIn)).statusCode,
    204,
  );
  assert.deepEqual(await choice(), { choice: builtIn });
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: nativeHttpRoutes.themeChoice,
        headers: bearer,
      })
    ).statusCode,
    204,
  );
  assert.deepEqual(await choice(), {});

  const theme = ownedThemeSchema.parse(
    (await sent(app, "POST", nativeHttpRoutes.ownThemes, passing)).json(),
  ).theme;
  const owned = { kind: "Owned", theme } as const;
  assert.equal(
    (await sent(app, "PUT", nativeHttpRoutes.themeChoice, owned)).statusCode,
    204,
  );
  assert.deepEqual(await choice(), { choice: owned });
  await app.inject({
    method: "DELETE",
    url: themePath(theme),
    headers: bearer,
  });
  assert.deepEqual(await choice(), {}, "the deleted theme's choice is none");

  const unowned = await sent(app, "PUT", nativeHttpRoutes.themeChoice, owned);
  assert.equal(unowned.statusCode, 422);
  assert.equal(codeOf(unowned), "ThemeNotFound");
  for (const refused of [
    { kind: "BuiltIn", theme: "neon" },
    { kind: "Owned", theme: 0 },
    { kind: "Owned", theme: "1" },
    { kind: "Owned", theme: 1, principal: "someone-else" },
    {},
  ])
    assert.equal(
      (await sent(app, "PUT", nativeHttpRoutes.themeChoice, refused))
        .statusCode,
      400,
      JSON.stringify(refused),
    );
  assert.ok(principals.every((principal) => principal === caller));
});

test("no appearance route names a principal or a workspace, and an unauthenticated call reaches nothing", async () => {
  for (const route of [
    nativeHttpRoutes.ownThemes,
    nativeHttpRoutes.ownTheme,
    nativeHttpRoutes.themeChoice,
  ])
    assert.deepEqual(
      route.match(/:[a-z]+/gu) ?? [],
      route === nativeHttpRoutes.ownTheme ? [":theme"] : [],
      route,
    );
  const principals: string[] = [];
  await using app = appearanceApp(principals);
  for (const url of [
    nativeHttpRoutes.ownThemes,
    themePath(1),
    nativeHttpRoutes.themeChoice,
  ])
    assert.equal(
      (await app.inject({ url, headers: { authorization: "Bearer other" } }))
        .statusCode,
      401,
    );
  assert.deepEqual(principals, []);
});
