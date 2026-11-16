/**
 * What a theme document puts on the console's tokens, which theme a scope
 * wears, and the cache the first paint is drawn from.
 *
 * Every colour is written as `light-dark(light, dark)`, so the reader's own
 * light, dark or system choice still picks the side; a scheme the palette does
 * not carry keeps the sheet's own value on its side. The built-in default puts
 * nothing on the tokens, so a console with no theme is the sheet alone, and a
 * theme below the contract's contrast rule is never worn.
 */

import {
  builtInThemeDefault,
  builtInThemes,
  themeContrastFailures,
  themePaletteSchemes,
  themeRoles,
  themeSchemes,
  themeTextSizeRootPercents,
} from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeColours,
  ThemeDocument,
  ThemeFont,
  ThemeRole,
  ThemeScheme,
} from "../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import type { KeyValuePort } from "./sessionHolder.ts";

/** The tokens of `styles/tokens.css` each colour role defines. */
export const themeRoleTokens: Readonly<Record<ThemeRole, readonly string[]>> = {
  "surface-0": ["--surface-0"],
  "surface-1": ["--surface-1"],
  "surface-2": ["--surface-2"],
  "surface-inverse": ["--surface-inverse"],
  bubble: ["--bubble"],
  "ink-1": ["--ink-1"],
  "ink-2": ["--ink-2"],
  "ink-3": ["--ink-3"],
  "ink-inverse": ["--ink-inverse"],
  edge: ["--edge"],
  "edge-strong": ["--edge-strong"],
  "edge-control": ["--edge-control"],
  accent: ["--accent"],
  "ink-on-accent": ["--ink-on-accent"],
};

/** The stack of `styles/tokens.css` each font of the contract's roster names. */
export const themeFontStacks: Readonly<Record<ThemeFont, string>> = {
  System: "var(--font-prose-system)",
  Humanist: "var(--font-prose-humanist)",
  Serif: "var(--font-prose-serif)",
};

export const themeFontToken = "--font-prose";
export const themeTextRootToken = "--text-root";

/** Every token a theme may set, which is every token wearing the default takes off. */
export const themeTokens: readonly string[] = [
  ...themeRoles.flatMap((role) => themeRoleTokens[role]),
  themeFontToken,
  themeTextRootToken,
];

export interface ThemeAssignment {
  readonly property: string;
  readonly value: string;
}

function themeAssignmentsSide(
  schemes: readonly (readonly [ThemeScheme, ThemeColours])[],
  scheme: ThemeScheme,
): ThemeColours {
  const carried = schemes.find(([held]) => held === scheme)?.[1];
  if (carried !== undefined) return carried;
  const sheet = themePaletteSchemes(
    builtInThemes[builtInThemeDefault].palette,
  ).find(([held]) => held === scheme)?.[1];
  if (sheet === undefined)
    throw new Error(`the built-in default carries no ${scheme} scheme`);
  return sheet;
}

/** Whether a theme looks as the built-in default does, whatever its name. */
function themeAssignmentsDefault(theme: ThemeDocument): boolean {
  const sheet = builtInThemes[builtInThemeDefault];
  const schemes = themePaletteSchemes(theme.palette);
  const sheetSchemes = themePaletteSchemes(sheet.palette);
  return (
    theme.textSize === sheet.textSize &&
    theme.font === sheet.font &&
    themeSchemes.every((scheme) => {
      const drawn = themeAssignmentsSide(schemes, scheme);
      const drawnBySheet = themeAssignmentsSide(sheetSchemes, scheme);
      return themeRoles.every((role) => drawn[role] === drawnBySheet[role]);
    })
  );
}

/** The properties to set for a theme, none for the built-in default. */
export function themeAssignmentsOf(
  theme: ThemeDocument,
): readonly ThemeAssignment[] {
  if (themeAssignmentsDefault(theme)) return [];
  const schemes = themePaletteSchemes(theme.palette);
  const light = themeAssignmentsSide(schemes, "Light");
  const dark = themeAssignmentsSide(schemes, "Dark");
  return [
    ...themeRoles.flatMap((role) =>
      themeRoleTokens[role].map((property) => ({
        property,
        value: `light-dark(${light[role]}, ${dark[role]})`,
      })),
    ),
    { property: themeFontToken, value: themeFontStacks[theme.font] },
    {
      property: themeTextRootToken,
      value: `${String(themeTextSizeRootPercents[theme.textSize])}%`,
    },
  ];
}

/** The theme a console wears for `theme`: itself where it passes the contrast
 * rule, and the built-in default, refused, where it does not. */
export function themeWorn(theme: ThemeDocument): {
  readonly theme: ThemeDocument;
  readonly refused: boolean;
} {
  return themeContrastFailures(theme).length === 0
    ? { theme, refused: false }
    : { theme: builtInThemes[builtInThemeDefault], refused: true };
}

/** The reader's global theme, from their choice and, where it names one of
 * theirs, that theme's document; nothing until that document is read. */
export function themeGlobalOf(
  choice: ThemeChoice | undefined,
  owned: ThemeDocument | undefined,
): ThemeDocument | undefined {
  if (choice === undefined) return builtInThemes[builtInThemeDefault];
  switch (choice.kind) {
    case "BuiltIn":
      return builtInThemes[choice.theme];
    case "Owned":
      return owned;
  }
}

/** Where a theme is worn: one project, or anywhere outside every project. */
export type ThemeScope = PartitionIdentity | undefined;

/** The scope of a route's parameters: a project where it names both halves. */
export function themeScopeOf(params: {
  readonly tenant?: string | undefined;
  readonly project?: string | undefined;
}): ThemeScope {
  return params.tenant === undefined || params.project === undefined
    ? undefined
    : { tenant: params.tenant, project: params.project };
}

export const themeCacheKey = "chuggy-theme-applied";

/** The most scopes the cache keeps, the latest worn first. */
export const themeCacheScopesMax = 16;

interface ThemeCacheEntry {
  readonly scope: string;
  readonly assignments: readonly ThemeAssignment[];
}

function themeCacheScopeKey(scope: ThemeScope): string {
  return JSON.stringify(
    scope === undefined ? [] : [scope.tenant, scope.project],
  );
}

function themeCacheAssignment(value: unknown): ThemeAssignment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { property, value: assigned } = value as Record<string, unknown>;
  return typeof property === "string" &&
    typeof assigned === "string" &&
    themeTokens.includes(property)
    ? { property, value: assigned }
    : undefined;
}

function themeCacheEntry(value: unknown): ThemeCacheEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { scope, assignments } = value as Record<string, unknown>;
  if (typeof scope !== "string" || !Array.isArray(assignments))
    return undefined;
  const read = assignments.map(themeCacheAssignment);
  return read.every((assignment) => assignment !== undefined)
    ? { scope, assignments: read }
    : undefined;
}

function themeCacheEntries(store: KeyValuePort): readonly ThemeCacheEntry[] {
  const held = store.read(themeCacheKey);
  if (held === null) return [];
  try {
    const parsed: unknown = JSON.parse(held);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, themeCacheScopesMax)
      .map(themeCacheEntry)
      .filter((entry) => entry !== undefined);
  } catch {
    return [];
  }
}

/** What was last worn in `scope`, and nothing where it was the default or
 * nothing is held for it. */
export function themeCacheRead(
  store: KeyValuePort,
  scope: ThemeScope,
): readonly ThemeAssignment[] {
  const key = themeCacheScopeKey(scope);
  return (
    themeCacheEntries(store).find((entry) => entry.scope === key)
      ?.assignments ?? []
  );
}

/** Keeps what `scope` now wears, the default being kept as no entry. */
export function themeCacheWrite(
  store: KeyValuePort,
  scope: ThemeScope,
  assignments: readonly ThemeAssignment[],
): void {
  const key = themeCacheScopeKey(scope);
  const others = themeCacheEntries(store).filter(
    (entry) => entry.scope !== key,
  );
  const entries = (
    assignments.length === 0 ? others : [{ scope: key, assignments }, ...others]
  ).slice(0, themeCacheScopesMax);
  if (entries.length === 0) store.remove(themeCacheKey);
  else store.write(themeCacheKey, JSON.stringify(entries));
}
