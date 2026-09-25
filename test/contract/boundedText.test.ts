/**
 * The contract's bounded-text rule, held to the platform's own answer on
 * well-formedness, which the browser library the contract is checked against
 * cannot name.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { boundedTextRefusal, isBoundedText } from "../../src/contract/http.ts";

/** The code units either side of every surrogate boundary, a NUL and a plain letter. */
const boundaryUnits = [
  "a",
  "\u0000",
  "퟿",
  "\uD800",
  "\uDBFF",
  "\uDC00",
  "\uDFFF",
  "",
];

/** Every non-empty string of boundary units up to `unitsMax` long, so every order of a pair and its halves appears. */
function boundaryStrings(unitsMax: number): readonly string[] {
  const strings: string[] = [];
  let layer: readonly string[] = [""];
  for (let units = 1; units <= unitsMax; units++) {
    layer = layer.flatMap((prefix) =>
      boundaryUnits.map((unit) => prefix + unit),
    );
    strings.push(...layer);
  }
  return strings;
}

test("a string is refused as unpaired exactly where it is not well formed", () => {
  const charsMax = Number.MAX_SAFE_INTEGER;
  for (const value of boundaryStrings(4)) {
    assert.equal(
      boundedTextRefusal(value, charsMax)?.refused === "Unpaired",
      !value.isWellFormed(),
      JSON.stringify(value),
    );
  }
});

test("a well-formed pair is bounded text and either half alone is not", () => {
  const pair = "😀";
  assert.equal(isBoundedText(pair, 1), true);
  assert.equal(isBoundedText(pair.slice(0, 1), 1), false);
  assert.equal(isBoundedText(pair.slice(1), 1), false);
});
