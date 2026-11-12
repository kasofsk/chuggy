/**
 * The theme wire: what a theme document refuses, the WCAG ratio against pairs
 * whose ratio is known, every built-in passing the contrast rule in each scheme
 * it carries, and the console's own look and its state fills held to the
 * stylesheet they are taken from.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  type ThemeColours,
  type ThemeDocument,
  builtInThemeIds,
  builtInThemes,
  contrastRatio,
  themeChoiceSchema,
  themeColourMix,
  themeContrastFailures,
  themeContrastMarkMin,
  themeContrastPairs,
  themeContrastTextMin,
  themeDocumentSchema,
  themeFixedColours,
  themeFillColour,
  themeFillDarkPercent,
  themeFills,
  themeFixedRoles,
  themeNameCharsMax,
  themePaletteSchemes,
  themeRoles,
  themeTextSizeRootPercents,
  themeTextSizes,
} from "../../src/contract/appearance.ts";

const chuggy = builtInThemes.chuggy;

function chuggyLight(): ThemeColours {
  assert.equal(chuggy.palette.schemes, "Both");
  return { ...chuggy.palette.light };
}

function documentWith(change: Record<string, unknown>): unknown {
  return { ...chuggy, ...change };
}

test("a theme document parses with every role set in the schemes it names", () => {
  assert.deepEqual(themeDocumentSchema.parse(chuggy), chuggy);
  const light = chuggyLight();
  const lightOnly = documentWith({ palette: { schemes: "Light", light } });
  assert.equal(themeDocumentSchema.safeParse(lightOnly).success, true);
});

test("a theme document refuses a role outside the roster and a role left out", () => {
  const fixed = { ...chuggyLight(), "tone-pass": "#287740" };
  const unknown = { ...chuggyLight(), glow: "#ffffff" };
  const { accent, ...missing } = chuggyLight();
  assert.equal(typeof accent, "string");
  for (const light of [fixed, unknown, missing]) {
    const theme = documentWith({ palette: { schemes: "Light", light } });
    assert.equal(themeDocumentSchema.safeParse(theme).success, false);
  }
});

test("a theme document refuses a colour that is not six lower-case hex digits", () => {
  for (const colour of [
    "#FFFFFF",
    "#fff",
    "#ffffffff",
    "ffffff",
    "red",
    "#ggg000",
    "rgb(0,0,0)",
  ]) {
    const light = { ...chuggyLight(), accent: colour };
    const theme = documentWith({ palette: { schemes: "Light", light } });
    assert.equal(themeDocumentSchema.safeParse(theme).success, false, colour);
  }
});

test("a theme document refuses a palette missing the scheme it names", () => {
  const light = chuggyLight();
  for (const palette of [
    { schemes: "Both", light },
    { schemes: "Dark", light },
    { schemes: "Light", light, dark: light },
    { schemes: "Neither", light },
  ]) {
    assert.equal(
      themeDocumentSchema.safeParse(documentWith({ palette })).success,
      false,
    );
  }
});

test("a theme's name is bounded and not blank", () => {
  const longest = "n".repeat(themeNameCharsMax);
  assert.equal(
    themeDocumentSchema.safeParse(documentWith({ name: longest })).success,
    true,
  );
  for (const name of [`${longest}n`, "", "   "]) {
    assert.equal(
      themeDocumentSchema.safeParse(documentWith({ name })).success,
      false,
    );
  }
});

test("a theme document refuses a font or a text size outside its roster, and any further field", () => {
  for (const change of [
    { font: "Comic" },
    { font: "system-ui, sans-serif" },
    { textSize: "Huge" },
    { textSize: 16 },
    { css: ":root { --accent: red }" },
  ]) {
    assert.equal(
      themeDocumentSchema.safeParse(documentWith(change)).success,
      false,
    );
  }
});

test("the text-size steps grow from smallest to largest, the standard one being the browser's own", () => {
  const percents = themeTextSizes.map(
    (step) => themeTextSizeRootPercents[step],
  );
  assert.deepEqual(
    [...percents].sort((left, right) => left - right),
    percents,
  );
  assert.equal(new Set(percents).size, percents.length);
  assert.equal(themeTextSizeRootPercents.Standard, 100);
});

test("a choice names a built-in by its id or an owned theme by its number", () => {
  for (const theme of builtInThemeIds) {
    assert.equal(
      themeChoiceSchema.safeParse({ kind: "BuiltIn", theme }).success,
      true,
    );
  }
  assert.equal(
    themeChoiceSchema.safeParse({ kind: "Owned", theme: 7 }).success,
    true,
  );
  for (const choice of [
    { kind: "BuiltIn", theme: "gallery" },
    { kind: "Owned", theme: 0 },
    { kind: "Owned", theme: "chuggy" },
    { kind: "Owned", theme: 1.5 },
    { kind: "Inline", theme: chuggy },
  ]) {
    assert.equal(themeChoiceSchema.safeParse(choice).success, false);
  }
});

test("the contrast ratio is the WCAG one for pairs whose ratio is known", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.equal(contrastRatio("#767676", "#ffffff").toFixed(2), "4.54");
  assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(contrastRatio("#949494", "#ffffff").toFixed(2), "3.03");
  assert.equal(contrastRatio("#ff0000", "#ffffff").toFixed(2), "4.00");
  assert.throws(() => contrastRatio("#FFF", "#000000"));
});

test("the thresholds are the WCAG minimums for text and for marks that are not text", () => {
  assert.equal(themeContrastTextMin, 4.5);
  assert.equal(themeContrastMarkMin, 3);
});

test("the contrast rule reads every fixed colour and every ground a theme sets", () => {
  const foregrounds = new Set(
    themeContrastPairs.map((pair) => pair.foreground),
  );
  for (const role of themeFixedRoles) assert.ok(foregrounds.has(role), role);
  const backgrounds = new Set(
    themeContrastPairs.map((pair) => pair.background),
  );
  for (const role of [
    "surface-0",
    "surface-1",
    "surface-2",
    "surface-inverse",
    "bubble",
    "accent",
  ] as const) {
    assert.ok(backgrounds.has(role), role);
  }
  for (const fill of themeFills) {
    assert.ok(
      themeContrastPairs.some(
        (pair) =>
          pair.foreground === "ink-inverse" &&
          pair.background === fill &&
          pair.ratioMin === themeContrastTextMin,
      ),
      fill,
    );
  }
});

test("every built-in carries both schemes and passes the contrast rule in each", () => {
  for (const id of builtInThemeIds) {
    const theme = builtInThemes[id];
    assert.deepEqual(themeDocumentSchema.parse(theme), theme, id);
    assert.equal(theme.palette.schemes, "Both", id);
    assert.equal(themePaletteSchemes(theme.palette).length, 2, id);
    assert.deepEqual(themeContrastFailures(theme), [], id);
  }
});

test("a theme answers every pair it draws too faintly, a fixed tone on its surfaces among them", () => {
  const light = {
    ...chuggyLight(),
    "ink-3": "#a0a0a0",
    "surface-1": "#7a7a7a",
  };
  const theme: ThemeDocument = {
    ...chuggy,
    palette: { schemes: "Light", light },
  };
  const failures = themeContrastFailures(theme);
  assert.ok(failures.every((failure) => failure.scheme === "Light"));
  assert.ok(failures.every((failure) => failure.ratio < failure.ratioMin));
  const named = failures.map(
    (failure) => `${failure.foreground} on ${failure.background}`,
  );
  assert.ok(named.includes("ink-3 on surface-0"));
  assert.ok(named.includes("tone-fail on surface-1"));
  assert.ok(named.includes("syntax-key on surface-1"));
  assert.ok(!named.includes("ink-1 on surface-0"));
});

test("inverse ink a theme sets is held to every state fill it is drawn on", () => {
  const light = { ...chuggyLight(), "ink-inverse": "#c0c0c0" };
  const failures = themeContrastFailures({
    ...chuggy,
    palette: { schemes: "Light", light },
  });
  const named = failures.map(
    (failure) => `${failure.foreground} on ${failure.background}`,
  );
  assert.ok(named.includes("ink-inverse on fill-pass"));
  assert.ok(!named.includes("ink-inverse on surface-inverse"));
  for (const failure of failures) {
    assert.equal(failure.foreground, "ink-inverse");
    assert.equal(failure.ratioMin, themeContrastTextMin);
  }
});

test("a dark fill is mixed with the theme's own page, so the page decides whether inverse ink reads on it", () => {
  assert.equal(chuggy.palette.schemes, "Both");
  const dark = { ...chuggy.palette.dark, "ink-inverse": "#2a2a2a" };
  assert.equal(
    themeFillColour("Light", dark, "fill-live"),
    themeFixedColours.Light["tone-live"],
  );
  const failsOnLive = (page: string): boolean =>
    themeContrastFailures({
      ...chuggy,
      palette: { schemes: "Dark", dark: { ...dark, "surface-0": page } },
    }).some(
      (failure) =>
        failure.foreground === "ink-inverse" &&
        failure.background === "fill-live",
    );
  assert.equal(failsOnLive(dark["surface-0"]), true);
  assert.equal(failsOnLive("#ffffff"), false);
});

test("colours mix channel by channel in sRGB", () => {
  assert.equal(themeColourMix("#ffffff", "#000000", 100), "#ffffff");
  assert.equal(themeColourMix("#ffffff", "#000000", 0), "#000000");
  assert.equal(themeColourMix("#ff0000", "#0000ff", 50), "#800080");
  assert.equal(themeColourMix("#640000", "#000000", 78), "#4e0000");
});

test("a dark palette is held to the dark fixed colours", () => {
  assert.equal(chuggy.palette.schemes, "Both");
  const dark = { ...chuggy.palette.dark, "surface-0": "#9a9a9a" };
  const failures = themeContrastFailures({
    ...chuggy,
    palette: { schemes: "Dark", dark },
  });
  assert.ok(failures.length > 0);
  assert.ok(
    failures.every(
      (failure) =>
        failure.scheme === "Dark" && failure.background === "surface-0",
    ),
  );
  assert.ok(failures.some((failure) => failure.foreground === "tone-parked"));
});

const tokensSheet = readFileSync(
  new URL("../../ui/chuggy-ui/app/styles/tokens.css", import.meta.url),
  "utf8",
);

function tokensSheetPair(token: string): readonly [string, string] {
  const pattern = new RegExp(
    `--${token}:\\s*light-dark\\(\\s*(#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\s*\\)`,
    "u",
  );
  const found = pattern.exec(tokensSheet);
  assert.ok(found?.[1] !== undefined && found[2] !== undefined, token);
  return [found[1], found[2]];
}

test("the chuggy theme and the fixed colours are the console's stylesheet", () => {
  assert.equal(chuggy.palette.schemes, "Both");
  const { light, dark } = chuggy.palette;
  for (const role of themeRoles.filter(
    (role) => role !== "accent" && role !== "ink-on-accent",
  )) {
    assert.deepEqual([light[role], dark[role]], tokensSheetPair(role), role);
  }
  for (const role of themeFixedRoles) {
    assert.deepEqual(
      [themeFixedColours.Light[role], themeFixedColours.Dark[role]],
      tokensSheetPair(role),
      role,
    );
  }
});

test("the chuggy accent is the inverse surface its primary button is drawn in today", () => {
  assert.equal(chuggy.palette.schemes, "Both");
  for (const colours of [chuggy.palette.light, chuggy.palette.dark]) {
    assert.equal(colours.accent, colours["surface-inverse"]);
    assert.equal(colours["ink-on-accent"], colours["ink-inverse"]);
  }
});

test("the fills are the console's stylesheet: a tone in light, mixed with the page in dark", () => {
  assert.ok(
    tokensSheet.includes(`--fill-dark: ${themeFillDarkPercent}%;`),
    "fill-dark",
  );
  for (const fill of themeFills) {
    const tone = fill.replace(/^fill-/u, "tone-");
    const pattern = new RegExp(
      `--${fill}:\\s*light-dark\\(\\s*var\\(--${tone}\\),\\s*color-mix\\(\\s*in srgb,\\s*var\\(--${tone}\\) var\\(--fill-dark\\),\\s*var\\(--surface-0\\)\\s*\\)\\s*\\)`,
      "u",
    );
    assert.ok(pattern.test(tokensSheet), fill);
  }
});
