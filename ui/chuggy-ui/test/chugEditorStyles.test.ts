/**
 * The ticket editor's colours: every one its own theme and its syntax
 * highlighting state is a token the tokens define, so a theme that sets the
 * tokens repaints the editor with the rest of the page.
 */

import { expect, test } from "vitest";

import {
  chugEditorStyles,
  ticketHighlighting,
} from "../app/browser/editor/chugEditor.ts";
import tokenSheet from "../app/styles/tokens.css?raw";

const chugEditorColourProperties = new Set([
  "color",
  "background",
  "backgroundColor",
  "caretColor",
  "border",
  "borderRight",
  "borderLeft",
  "borderLeftColor",
]);

/** Every colour a spec states, with the selector it is stated under. */
function chugEditorColoursOf(
  spec: object,
  under: string,
): readonly (readonly [string, string])[] {
  return Object.entries(spec).flatMap(([key, value]: [string, unknown]) => {
    if (typeof value === "object" && value !== null)
      return chugEditorColoursOf(value, `${under} ${key}`);
    return chugEditorColourProperties.has(key) && typeof value === "string"
      ? [[`${under} ${key}`, value] as const]
      : [];
  });
}

const defined = new Set(
  Array.from(
    tokenSheet.matchAll(/^\s*(--[a-z0-9-]+):/gmu),
    (found) => found[1],
  ),
);

/** A colour value is a token, a border drawn in one, or a keyword that chooses no colour. */
function chugEditorDrawnFromTokens(value: string): boolean {
  if (value === "inherit" || value === "none") return true;
  const tokens = Array.from(value.matchAll(/var\((--[a-z0-9-]+)\)/gu));
  const rest = value.replace(/var\(--[a-z0-9-]+\)/gu, "").trim();
  return (
    tokens.length > 0 &&
    tokens.every((found) => defined.has(found[1])) &&
    ["", "solid"].includes(rest)
  );
}

test("every colour the editor's theme states is a token the tokens define", () => {
  const colours = chugEditorColoursOf(chugEditorStyles, "");
  expect(colours.length).toBeGreaterThan(0);
  for (const [where, value] of colours)
    expect(chugEditorDrawnFromTokens(value), `${where}: ${value}`).toBe(true);
});

test("every syntax colour is a token the tokens define", () => {
  const colours = ticketHighlighting.specs.flatMap((spec, index) =>
    chugEditorColoursOf({ ...spec, tag: undefined }, `spec ${index}`),
  );
  expect(colours.map(([, value]) => value)).toStrictEqual([
    "var(--syntax-key)",
    "var(--syntax-string)",
    "var(--syntax-value)",
    "var(--syntax-note)",
  ]);
  for (const [where, value] of colours)
    expect(chugEditorDrawnFromTokens(value), `${where}: ${value}`).toBe(true);
});

test("a literal colour or an undefined token in a colour is not drawn from tokens", () => {
  expect(chugEditorDrawnFromTokens("#3658c7")).toBe(false);
  expect(chugEditorDrawnFromTokens("var(--hairline) solid red")).toBe(false);
  expect(chugEditorDrawnFromTokens("var(--syntax-colour-unset)")).toBe(false);
  expect(chugEditorDrawnFromTokens("var(--hairline) solid var(--edge)")).toBe(
    true,
  );
});
