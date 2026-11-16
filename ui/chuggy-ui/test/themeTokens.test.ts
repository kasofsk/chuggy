/**
 * What a theme document puts on the tokens, held to the contract's rosters and
 * to `tokens.css`, which theme a scope wears, and the cache the first paint
 * reads, kept apart scope by scope.
 */

import { expect, test } from "vitest";

import {
  builtInThemeDefault,
  builtInThemes,
  themeFonts,
  themeRoles,
  themeTextSizeRootPercents,
} from "../../../src/contract/appearance.ts";
import type { ThemeDocument } from "../../../src/contract/appearance.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import {
  themeAssignmentsOf,
  themeCacheKey,
  themeCacheRead,
  themeCacheScopesMax,
  themeCacheWrite,
  themeFontStacks,
  themeFontToken,
  themeGlobalOf,
  themeRoleTokens,
  themeScopeOf,
  themeTextRootToken,
  themeTokens,
  themeWorn,
} from "../app/core/themeTokens.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { tokenContrastDeclarations } from "./tokenContrastColours.ts";

const declared = tokenContrastDeclarations(tokenSheet);

const sheetTheme = builtInThemes[builtInThemeDefault];
const harbour = builtInThemes.harbour;

function storeDouble(held: Record<string, string> = {}): KeyValuePort {
  return {
    read: (key) => held[key] ?? null,
    write: (key, value) => {
      held[key] = value;
    },
    remove: (key) => {
      delete held[key];
    },
  };
}

function assignmentsByProperty(
  theme: ThemeDocument,
): ReadonlyMap<string, string> {
  return new Map(
    themeAssignmentsOf(theme).map(({ property, value }) => [property, value]),
  );
}

test("every colour role of the contract's roster maps to tokens the sheet declares, and no other key is mapped", () => {
  expect(Object.keys(themeRoleTokens).sort()).toStrictEqual(
    [...themeRoles].sort(),
  );
  for (const role of themeRoles) {
    expect(themeRoleTokens[role].length, role).toBeGreaterThan(0);
    for (const token of themeRoleTokens[role])
      expect(declared.has(token.slice(2)), token).toBe(true);
  }
});

test("every font of the contract's roster names a stack the sheet declares, and the text size and font set tokens it declares", () => {
  expect(Object.keys(themeFontStacks).sort()).toStrictEqual(
    [...themeFonts].sort(),
  );
  for (const font of themeFonts) {
    const named = /^var\(--([a-z-]+)\)$/u.exec(themeFontStacks[font])?.[1];
    expect(named !== undefined && declared.has(named), font).toBe(true);
  }
  for (const token of [themeFontToken, themeTextRootToken])
    expect(declared.has(token.slice(2)), token).toBe(true);
  expect(declared.get(themeFontToken.slice(2))).toBe(themeFontStacks.System);
});

test("the built-in default sets nothing, so a console with no theme is the sheet alone", () => {
  expect(themeAssignmentsOf(sheetTheme)).toStrictEqual([]);
  expect(
    themeAssignmentsOf({ ...sheetTheme, name: "Chuggy, renamed" }),
  ).toStrictEqual([]);
});

test("a theme sets each role's tokens to its light and dark values, and its font and text size", () => {
  const theme: ThemeDocument = { ...harbour, font: "Serif", textSize: "Large" };
  const set = assignmentsByProperty(theme);
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  for (const role of themeRoles)
    for (const token of themeRoleTokens[role])
      expect(set.get(token), role).toBe(
        `light-dark(${harbour.palette.light[role]}, ${harbour.palette.dark[role]})`,
      );
  expect(set.get(themeFontToken)).toBe("var(--font-prose-serif)");
  expect(set.get(themeTextRootToken)).toBe(
    `${String(themeTextSizeRootPercents.Large)}%`,
  );
  expect([...set.keys()].sort()).toStrictEqual([...themeTokens].sort());
});

test("a scheme the palette does not carry keeps the sheet's own value on its side", () => {
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  const lightOnly: ThemeDocument = {
    ...harbour,
    palette: { schemes: "Light", light: harbour.palette.light },
  };
  const set = assignmentsByProperty(lightOnly);
  for (const role of themeRoles) {
    const sheetDark = /,\s*(#[0-9a-f]{6})\s*\)$/u.exec(
      declared.get(role) ?? "",
    );
    expect(set.get(`--${role}`), role).toBe(
      `light-dark(${harbour.palette.light[role]}, ${sheetDark?.[1] ?? ""})`,
    );
  }
});

test("a theme below the contrast rule is never worn: the default is, and the refusal is said", () => {
  if (harbour.palette.schemes !== "Both")
    throw new Error("Harbour carries both schemes");
  const faint: ThemeDocument = {
    ...harbour,
    palette: {
      ...harbour.palette,
      light: { ...harbour.palette.light, "ink-3": harbour.palette.light.edge },
    },
  };
  expect(themeWorn(faint)).toStrictEqual({ theme: sheetTheme, refused: true });
  expect(themeWorn(harbour)).toStrictEqual({ theme: harbour, refused: false });
});

test("every built-in theme passes the contrast rule, so each is worn as itself", () => {
  for (const theme of Object.values(builtInThemes))
    expect(themeWorn(theme).refused, theme.name).toBe(false);
});

test("the global theme is the default with no choice, a built-in by its id, and an owned theme once its document is read", () => {
  expect(themeGlobalOf(undefined, undefined)).toBe(sheetTheme);
  expect(themeGlobalOf({ kind: "BuiltIn", theme: "ember" }, undefined)).toBe(
    builtInThemes.ember,
  );
  expect(themeGlobalOf({ kind: "Owned", theme: 3 }, undefined)).toBeUndefined();
  expect(themeGlobalOf({ kind: "Owned", theme: 3 }, harbour)).toBe(harbour);
});

test("a scope is a project only where both halves are named", () => {
  expect(themeScopeOf({ tenant: "acme", project: "atlas" })).toStrictEqual({
    tenant: "acme",
    project: "atlas",
  });
  expect(themeScopeOf({ tenant: "acme" })).toBeUndefined();
  expect(themeScopeOf({})).toBeUndefined();
});

test("what one project wore is read back for it and for no other project, nor outside every project", () => {
  const store = storeDouble();
  const atlas = { tenant: "acme", project: "atlas" };
  const worn = themeAssignmentsOf(harbour);
  themeCacheWrite(store, atlas, worn);
  expect(themeCacheRead(store, atlas)).toStrictEqual(worn);
  expect(themeCacheRead(store, { tenant: "acme", project: "zephyr" })).toEqual(
    [],
  );
  expect(themeCacheRead(store, { tenant: "zephyr", project: "atlas" })).toEqual(
    [],
  );
  expect(themeCacheRead(store, undefined)).toEqual([]);
});

test("a scope whose halves join to another's is still its own", () => {
  const store = storeDouble();
  themeCacheWrite(
    store,
    { tenant: "a/b", project: "c" },
    themeAssignmentsOf(harbour),
  );
  expect(themeCacheRead(store, { tenant: "a", project: "b/c" })).toEqual([]);
});

test("wearing the default in a scope takes its entry away and leaves the others", () => {
  const held: Record<string, string> = {};
  const store = storeDouble(held);
  const atlas = { tenant: "acme", project: "atlas" };
  themeCacheWrite(store, atlas, themeAssignmentsOf(harbour));
  themeCacheWrite(store, undefined, themeAssignmentsOf(builtInThemes.ember));
  themeCacheWrite(store, atlas, []);
  expect(themeCacheRead(store, atlas)).toEqual([]);
  expect(themeCacheRead(store, undefined)).toStrictEqual(
    themeAssignmentsOf(builtInThemes.ember),
  );
  themeCacheWrite(store, undefined, []);
  expect(themeCacheKey in held).toBe(false);
});

test("the cache keeps the latest scopes worn and no more", () => {
  const store = storeDouble();
  const worn = themeAssignmentsOf(harbour);
  const scopes = Array.from({ length: themeCacheScopesMax + 1 }, (_, at) => ({
    tenant: "acme",
    project: `project-${String(at)}`,
  }));
  for (const scope of scopes) themeCacheWrite(store, scope, worn);
  expect(themeCacheRead(store, scopes[0])).toEqual([]);
  for (const scope of scopes.slice(1))
    expect(themeCacheRead(store, scope)).toStrictEqual(worn);
});

test("a cache this console did not write, or naming a property no theme sets, is read as nothing", () => {
  const scope = undefined;
  for (const held of [
    "not json",
    JSON.stringify({ scope: "[]" }),
    JSON.stringify([{ scope: "[]", assignments: "none" }]),
    JSON.stringify([
      { scope: "[]", assignments: [{ property: "color", value: "inherit" }] },
    ]),
  ])
    expect(
      themeCacheRead(storeDouble({ [themeCacheKey]: held }), scope),
      held,
    ).toEqual([]);
});
