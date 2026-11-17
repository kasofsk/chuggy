/**
 * A token's colour as `tokens.css` defines it, followed to six hex digits in
 * one scheme, for a suite that holds a colour the console draws to the
 * contrast rule.
 */

import { expect } from "vitest";

import {
  type ThemeScheme,
  themeColourMix,
} from "../../../src/contract/appearance.ts";

/** The declarations of the sheet's first `:root` rule, by name. */
export function tokenContrastDeclarations(
  text: string,
): ReadonlyMap<string, string> {
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
export function tokenContrastColour(
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
