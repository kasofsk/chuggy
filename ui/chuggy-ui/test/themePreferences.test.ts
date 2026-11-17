/**
 * What the theme controls say and mark, from the reader's global choice and a
 * project's resolved read: each layer's wording, the note under the global
 * picker where the project's default covers it, the override set and cleared,
 * and the order the pickers offer themes in.
 */

import { expect, test } from "vitest";

import {
  builtInThemeIds,
  builtInThemes,
} from "../../../src/contract/appearance.ts";
import type { ThemeDocument } from "../../../src/contract/appearance.ts";
import type { ProjectAppearanceResponse } from "../../../src/contract/responses.ts";
import { themeColourAssignmentsOf } from "../app/core/themeTokens.ts";
import {
  themeGlobalChosen,
  themeOverrideChosen,
  themePickerKeyOf,
  themePickerOptions,
  themePickerProjectDefault,
  themePreferencesOf,
  themeRefusalOf,
  themeResolvedOf,
} from "../app/core/themePreferences.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

const { chuggy, harbour, ember } = builtInThemes;

const mine: ThemeDocument = { ...harbour, name: "Mine" };
const owned = [{ theme: 7, document: mine }];

const harbourChoice = { kind: "BuiltIn", theme: "harbour" } as const;
const emberChoice = { kind: "BuiltIn", theme: "ember" } as const;
const mineChoice = { kind: "Owned", theme: 7 } as const;

function said(appearance: ProjectAppearanceResponse): string | undefined {
  const project = themePreferencesOf(undefined, appearance).project;
  return project === undefined
    ? undefined
    : `${project.applies}: ${copyTextEn(project.because)}`;
}

test("each layer is said in plain words, naming the theme that applies", () => {
  expect(
    said(themeResolvedOf({ override: harbourChoice, global: emberChoice }, [])),
  ).toBe("Harbour: Your choice for this project");
  expect(
    said(themeResolvedOf({ projectDefault: ember, global: harbourChoice }, [])),
  ).toBe("Ember: The project's default");
  expect(said(themeResolvedOf({ global: mineChoice }, owned))).toBe(
    "Mine: Your own theme",
  );
  expect(said(themeResolvedOf({}, []))).toBe("Chuggy: The console's default");
});

test("the global picker says the project's default covers it only where that default is what applies", () => {
  const covered = themePreferencesOf(
    harbourChoice,
    themeResolvedOf({ projectDefault: ember, global: harbourChoice }, []),
  ).global.covered;
  expect(covered === undefined ? undefined : copyTextEn(covered)).toBe(
    "This project shows its own default theme in place of yours.",
  );
  for (const layers of [
    { override: emberChoice, projectDefault: ember },
    { global: harbourChoice },
    {},
  ])
    expect(
      themePreferencesOf(harbourChoice, themeResolvedOf(layers, [])).global
        .covered,
    ).toBeUndefined();
  expect(themePreferencesOf(harbourChoice, undefined).global.covered).toBe(
    undefined,
  );
});

test("outside every project there is no project row, and the global picker marks the choice or the built-in default", () => {
  expect(themePreferencesOf(emberChoice, undefined)).toStrictEqual({
    global: { chosen: themePickerKeyOf(emberChoice), covered: undefined },
    project: undefined,
  });
  expect(themePreferencesOf(undefined, undefined).global.chosen).toBe(
    themePickerKeyOf({ kind: "BuiltIn", theme: "chuggy" }),
  );
});

test("an override set applies above the project's default, and cleared marks the project's default and falls through to it", () => {
  const read = themeResolvedOf(
    { projectDefault: ember, global: harbourChoice },
    [],
  );
  const set = themeOverrideChosen(read, mineChoice, owned);
  expect(set.theme).toBe(mine);
  expect(set.layer).toBe("ProjectOverride");
  expect(themePreferencesOf(harbourChoice, set).project?.chosen).toBe(
    themePickerKeyOf(mineChoice),
  );
  const cleared = themeOverrideChosen(set, undefined, owned);
  expect(cleared).toStrictEqual(read);
  expect(themePreferencesOf(harbourChoice, cleared).project?.chosen).toBe(
    themePickerProjectDefault,
  );
});

test("a global choice changes the project's theme only where no higher layer is set", () => {
  const plain = themeResolvedOf({ global: harbourChoice }, []);
  expect(themeGlobalChosen(plain, emberChoice, []).theme).toBe(ember);
  const defaulted = themeResolvedOf({ projectDefault: harbour }, []);
  expect(themeGlobalChosen(defaulted, emberChoice, []).theme).toBe(harbour);
});

test("a layer naming a theme the reader does not own resolves as that layer unset", () => {
  const resolved = themeResolvedOf(
    { override: mineChoice, global: { kind: "Owned", theme: 8 } },
    owned.filter((theme) => theme.theme !== 7),
  );
  expect(resolved).toStrictEqual({
    theme: chuggy,
    layer: "BuiltInDefault",
    layers: {},
  });
});

test("the built-ins come first in the contract's order, then the reader's own, each by a key of its own", () => {
  const options = themePickerOptions([
    ...owned,
    { theme: 9, document: { ...ember, name: "Also mine" } },
  ]);
  expect(options.map((option) => option.theme.name)).toStrictEqual([
    ...builtInThemeIds.map((id) => builtInThemes[id].name),
    "Mine",
    "Also mine",
  ]);
  expect(new Set(options.map((option) => option.key)).size).toBe(
    options.length,
  );
  expect(options.map((option) => option.key)).not.toContain(
    themePickerProjectDefault,
  );
});

test("a card's colours are the theme's own in both schemes, the built-in default's included", () => {
  const assigned = new Map(
    themeColourAssignmentsOf(chuggy).map(({ property, value }) => [
      property,
      value,
    ]),
  );
  if (chuggy.palette.schemes !== "Both")
    throw new Error("the default carries both schemes");
  expect(assigned.get("--accent")).toBe(
    `light-dark(${chuggy.palette.light.accent}, ${chuggy.palette.dark.accent})`,
  );
});

test("a refused write says the theme was not saved, and why: a theme no longer the reader's by name, anything else in the shared words", () => {
  expect(
    copyTextEn(
      themeRefusalOf({
        outcome: "Rejected",
        code: "ThemeNotFound",
        status: 422,
        body: {},
      }),
    ),
  ).toBe("Theme not saved · that theme is no longer one of yours");
  expect(
    copyTextEn(themeRefusalOf({ outcome: "Unreachable", reason: "offline" })),
  ).toBe("Theme not saved · No connection");
});
