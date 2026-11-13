/**
 * The console's tokens held to the contract's contrast rule in both schemes:
 * the inks and tones as text on the surfaces, washes and fills
 * `tokenContrastPairs` names, and the marks as marks on the page and a panel,
 * each colour read out of `tokens.css` itself, `light-dark()` pairs and mixes
 * alike. Left out are the inverse ink on the context's slots, which the light
 * scheme draws below the text minimum, and the inks on a primary and a filled
 * danger button's hover, mixes `Button.css` makes rather than tokens. Then the
 * rest of what a theme leans on there: the root size a text-size step sets,
 * the lengths that stay in px, a control's height under a coarse pointer, and
 * a disabled control's text and edge as marks.
 */

import { expect, test } from "vitest";

import {
  type ThemeScheme,
  contrastRatio,
  themeColourMix,
  themeContrastMarkMin,
  themeContrastTextMin,
  themeFillDarkPercent,
  themeWashPercent,
} from "../../../src/contract/appearance.ts";
import buttonSheet from "../app/browser/ui/Button.css?raw";
import radioSheet from "../app/browser/ui/RadioGroup.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";

/** The declarations of the sheet's first `:root` rule, by name. */
function tokenContrastDeclarations(text: string): ReadonlyMap<string, string> {
  const bare = text.replace(/\/\*[\s\S]*?\*\//gu, "");
  const opened = bare.indexOf(":root {");
  const block = bare.slice(opened, bare.indexOf("}", opened));
  const declared = new Map<string, string>();
  for (const found of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)) {
    declared.set(found[1] ?? "", (found[2] ?? "").replace(/\s+/gu, " "));
  }
  return declared;
}

/** A value's arguments, split at the commas no parenthesis holds. */
function tokenContrastArguments(inner: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (const [index, character] of [...inner].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/** A token's colour in one scheme, followed through `var()`, `light-dark()`
 * and `color-mix(in srgb, ...)` to six hex digits. */
function tokenContrastColour(
  declared: ReadonlyMap<string, string>,
  scheme: ThemeScheme,
  token: string,
): string {
  const value = declared.get(token);
  if (value === undefined) throw new Error(`no token --${token}`);
  return tokenContrastValue(declared, scheme, value);
}

function tokenContrastValue(
  declared: ReadonlyMap<string, string>,
  scheme: ThemeScheme,
  value: string,
): string {
  const called = /^([a-z-]+)\((.*)\)$/u.exec(value.trim());
  if (called === null) return value.trim();
  const [, name = "", inner = ""] = called;
  const parts = tokenContrastArguments(inner);
  switch (name) {
    case "var":
      return tokenContrastColour(declared, scheme, inner.replace(/^--/u, ""));
    case "light-dark":
      return tokenContrastValue(
        declared,
        scheme,
        scheme === "Light" ? (parts[0] ?? "") : (parts[1] ?? ""),
      );
    case "color-mix": {
      expect(parts[0]).toBe("in srgb");
      const [first = "", percent = ""] = tokenContrastArguments(
        (parts[1] ?? "").replace(/\) /u, "),"),
      );
      const share = tokenContrastValue(declared, scheme, percent);
      return themeColourMix(
        tokenContrastValue(declared, scheme, first),
        tokenContrastValue(declared, scheme, parts[2] ?? ""),
        Number.parseFloat(share),
      );
    }
    default:
      throw new Error(`a value the suite does not read: ${value}`);
  }
}

const tokenContrastInks = ["ink-1", "ink-2", "ink-3"] as const;
const tokenContrastToneNames = [
  "pass",
  "fail",
  "live",
  "evaluation",
  "finalization",
  "parked",
  "queued",
] as const;
const tokenContrastWashes = [
  ...tokenContrastToneNames.map((tone) => `wash-${tone}`),
  "wash-accent",
];
const tokenContrastFills = [
  "fill-pass",
  "fill-live",
  "fill-evaluation",
  "fill-finalization",
  "fill-parked",
  "fill-retired",
];

interface TokenContrastPair {
  readonly foreground: string;
  readonly background: string;
  readonly ratioMin: number;
}

function tokenContrastPairsOf(
  foregrounds: readonly string[],
  backgrounds: readonly string[],
  ratioMin: number,
): readonly TokenContrastPair[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background, ratioMin })),
  );
}

/** Each colour on the grounds the console draws it on. A tone is a state's
 * word, so it is text on every surface a row can be, a hovered row's among
 * them. */
const tokenContrastPairs: readonly TokenContrastPair[] = [
  ...tokenContrastPairsOf(
    tokenContrastInks,
    ["surface-0", "surface-1", "surface-2", "bubble", ...tokenContrastWashes],
    themeContrastTextMin,
  ),
  ...tokenContrastPairsOf(
    tokenContrastToneNames.map((tone) => `tone-${tone}`),
    ["surface-0", "surface-1", "surface-2"],
    themeContrastTextMin,
  ),
  ...tokenContrastToneNames.map((tone) => ({
    foreground: `tone-${tone}`,
    background: `wash-${tone}`,
    ratioMin: themeContrastTextMin,
  })),
  ...tokenContrastPairsOf(
    ["ink-inverse"],
    ["surface-inverse", ...tokenContrastFills],
    themeContrastTextMin,
  ),
  ...tokenContrastPairsOf(["ink-on-accent"], ["accent"], themeContrastTextMin),
  ...tokenContrastPairsOf(
    ["tone-on-danger"],
    ["tone-fail"],
    themeContrastTextMin,
  ),
  ...tokenContrastPairsOf(
    ["syntax-key", "syntax-string", "syntax-value"],
    ["surface-1", "surface-2"],
    themeContrastTextMin,
  ),
  ...tokenContrastPairsOf(
    ["edge-strong", "edge-control", "accent", "surface-inverse"],
    ["surface-0", "surface-1"],
    themeContrastMarkMin,
  ),
];

/** Every pair a sheet draws below the contrast it needs, named with its
 * scheme. */
function tokenContrastFailures(text: string): readonly string[] {
  const declared = tokenContrastDeclarations(text);
  return (["Light", "Dark"] as const).flatMap((scheme) =>
    tokenContrastPairs.flatMap((pair) => {
      const ratio = contrastRatio(
        tokenContrastColour(declared, scheme, pair.foreground),
        tokenContrastColour(declared, scheme, pair.background),
      );
      return ratio < pair.ratioMin
        ? [`${scheme}: ${pair.foreground} on ${pair.background}`]
        : [];
    }),
  );
}

test("every ink, tone and mark the tokens define clears the contrast it needs, in both schemes", () => {
  expect(tokenContrastFailures(tokenSheet)).toEqual([]);
});

test("a token edited below the contrast it needs is named, in the scheme it fails in", () => {
  const declared = tokenContrastDeclarations(tokenSheet);
  const strong = declared.get("edge-strong") ?? "";
  const pass = declared.get("tone-pass") ?? "";
  const faint = tokenSheet
    .replace(
      strong.slice(strong.indexOf("(") + 1, strong.indexOf(",")),
      "#9ea89f",
    )
    .replace(pass, "light-dark(#287740, #79c68f)")
    .replace("var(--tone-retired) 84%", "var(--tone-retired) var(--fill-dark)");
  expect(tokenContrastFailures(faint)).toEqual([
    "Light: tone-pass on surface-2",
    "Light: edge-strong on surface-0",
    "Light: edge-strong on surface-1",
    "Dark: ink-inverse on fill-retired",
  ]);
});

test("the suite follows a mix to the colour it makes", () => {
  const declared = tokenContrastDeclarations(tokenSheet);
  expect(tokenContrastColour(declared, "Light", "wash-live")).toBe(
    themeColourMix(
      tokenContrastColour(declared, "Light", "tone-live"),
      tokenContrastColour(declared, "Light", "surface-1"),
      themeWashPercent,
    ),
  );
  expect(tokenContrastColour(declared, "Dark", "fill-live")).toBe(
    themeColourMix(
      tokenContrastColour(declared, "Dark", "tone-live"),
      tokenContrastColour(declared, "Dark", "surface-0"),
      themeFillDarkPercent,
    ),
  );
});

test("the accent is the inverse surface and its ink the inverse ink until a theme sets them", () => {
  const declared = tokenContrastDeclarations(tokenSheet);
  for (const scheme of ["Light", "Dark"] as const) {
    expect(tokenContrastColour(declared, scheme, "accent")).toBe(
      tokenContrastColour(declared, scheme, "surface-inverse"),
    );
    expect(tokenContrastColour(declared, scheme, "ink-on-accent")).toBe(
      tokenContrastColour(declared, scheme, "ink-inverse"),
    );
  }
});

test("the root's size is one property, the browser's own until a theme's step sets it", () => {
  const rules = sheetRules(tokenSheet, []);
  const root = document.documentElement;
  expect(sheetDeclared(rules, root, "--text-root")).toBe("100%");
  expect(sheetDeclared(rules, root, "font-size")).toBe("var(--text-root)");
});

test("the lengths a text-size step must not scale stay in px", () => {
  const rules = sheetRules(tokenSheet, []);
  for (const token of [
    "--text-unzoomed",
    "--height-touch",
    "--radius-1",
    "--radius-2",
  ]) {
    expect(sheetDeclared(rules, document.documentElement, token)).toMatch(
      /^[0-9]+px$/u,
    );
  }
});

test("a control is today's height, and at least the touch height under a coarse pointer", () => {
  const root = document.documentElement;
  expect(
    sheetDeclared(sheetRules(tokenSheet, []), root, "--height-control"),
  ).toBe("var(--height-icon)");
  expect(
    sheetDeclared(
      sheetRules(tokenSheet, ["(pointer: coarse)"]),
      root,
      "--height-control",
    )?.replace(/\s/gu, ""),
  ).toBe("max(var(--height-touch),var(--height-icon))");
});

test("a disabled button's and radio's text and edge clear the mark minimum on the page and a panel, in both schemes", () => {
  const declared = tokenContrastDeclarations(tokenSheet);
  const disabled = [
    ...sheetRules(buttonSheet, []),
    ...sheetRules(radioSheet, []),
  ].filter((rule) => /^\.(btn|radio-item):disabled/u.test(rule.selectorText));
  const tokens = disabled.flatMap((rule) =>
    ["color", "border-color", "background"].flatMap((property) => {
      const found = /^var\(--([a-z0-9-]+)\)$/u.exec(
        rule.style.getPropertyValue(property),
      );
      return found === null ? [] : [found[1] ?? ""];
    }),
  );
  expect(new Set(tokens)).toEqual(new Set(["ink-3", "edge-strong"]));
  for (const scheme of ["Light", "Dark"] as const)
    for (const token of tokens)
      for (const ground of ["surface-0", "surface-1"])
        expect(
          contrastRatio(
            tokenContrastColour(declared, scheme, token),
            tokenContrastColour(declared, scheme, ground),
          ),
          `${scheme}: ${token} on ${ground}`,
        ).toBeGreaterThanOrEqual(themeContrastMarkMin);
});
