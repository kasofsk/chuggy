/**
 * The status badge over its whole roster: every tone draws its word and a mark
 * of its own shape, the compact form keeps the word for assistive technology,
 * and every tone's word clears the contrast rule on the badge's ground in both
 * schemes. The ground is opaque, so the surface under a badge never reaches its
 * word; what does meet that surface is the badge's hairline, held to the mark
 * minimum on each one.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  contrastRatio,
  themeContrastMarkMin,
  themeContrastTextMin,
  themeSchemes,
} from "../../../src/contract/appearance.ts";
import badgeSheet from "../app/browser/ui/StatusBadge.css?raw";
import {
  StatusBadge,
  statusBadgeMarkOf,
  statusBadgeSizes,
  statusBadgeTones,
} from "../app/browser/ui/StatusBadge.tsx";
import type { Tone } from "../app/core/tones.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";
import {
  tokenContrastColour,
  tokenContrastDeclarations,
} from "./tokenContrastColours.ts";

afterEach(cleanup);

const statusBadgeSurfaces = ["surface-0", "surface-1", "surface-2"] as const;

/** The token a badge of one tone declares for one of its own properties. */
function statusBadgeToken(
  sheet: string,
  tone: Tone,
  property: string,
  shape: { readonly size: string; readonly compact: boolean },
): string {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset["tone"] = tone;
  badge.dataset["size"] = shape.size;
  if (shape.compact) badge.dataset["compact"] = "true";
  const declared = sheetDeclared(sheetRules(sheet, []), badge, property);
  const token = /^var\(--([a-z0-9-]+)\)$/u.exec(declared)?.[1];
  if (token === undefined)
    throw new Error(`${tone} declares no token for ${property}: ${declared}`);
  return token;
}

/** Every tone whose word or edge a badge sheet draws below the contrast it
 * needs, named with its scheme and what it was drawn on. */
function statusBadgeContrastFailures(sheet: string): readonly string[] {
  const declared = tokenContrastDeclarations(tokenSheet);
  const shape = { size: "regular", compact: false };
  return themeSchemes.flatMap((scheme) =>
    statusBadgeTones.flatMap((tone) => {
      const colour = (token: string): string =>
        tokenContrastColour(declared, scheme, token);
      const ink = colour(
        statusBadgeToken(sheet, tone, "--status-badge-ink", shape),
      );
      const ground = colour(
        statusBadgeToken(sheet, tone, "--status-badge-ground", shape),
      );
      const word =
        contrastRatio(ink, ground) < themeContrastTextMin
          ? [`${scheme}: ${tone} on its ground`]
          : [];
      const edges = statusBadgeSurfaces.flatMap((surface) =>
        contrastRatio(ink, colour(surface)) < themeContrastMarkMin
          ? [`${scheme}: ${tone}'s edge on ${surface}`]
          : [],
      );
      return [...word, ...edges];
    }),
  );
}

test("every tone draws its word in both sizes, after a decorative mark of its tone's shape", () => {
  for (const size of statusBadgeSizes) {
    for (const tone of statusBadgeTones) {
      const view = render(
        <StatusBadge tone={tone} size={size}>
          {tone}
        </StatusBadge>,
      );
      const badge = screen.getByText(tone).parentElement;
      expect(badge?.classList.contains("status-badge")).toBe(true);
      expect(badge?.dataset["tone"]).toBe(tone);
      expect(badge?.dataset["size"]).toBe(size);
      const mark = badge?.querySelector(".status-badge-mark");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      expect(mark?.getAttribute("data-mark")).toBe(statusBadgeMarkOf[tone]);
      expect(view.container.querySelector("[style]")).toBeNull();
      styleless();
      cleanup();
    }
  }
});

test("no two tones share a mark, so colour is never the only thing telling them apart", () => {
  const marks = statusBadgeTones.map((tone) => statusBadgeMarkOf[tone]);
  expect(new Set(marks).size).toBe(statusBadgeTones.length);
});

test("the compact form hides the word from the eye and keeps it as the badge's whole text", () => {
  for (const tone of statusBadgeTones) {
    render(
      <StatusBadge tone={tone} size="small" compact>
        Escalated
      </StatusBadge>,
    );
    const word = screen.getByText("Escalated");
    expect(word.className).toBe("visually-hidden");
    const badge = word.parentElement;
    expect(badge?.dataset["compact"]).toBe("true");
    expect(badge?.textContent).toBe("Escalated");
    cleanup();
  }
});

test("every tone's word clears the text minimum on its ground, and its edge the mark minimum on every surface, in both schemes", () => {
  expect(statusBadgeContrastFailures(badgeSheet)).toEqual([]);
});

test("a badge's size and compact form change none of its colours", () => {
  for (const tone of statusBadgeTones) {
    for (const property of ["--status-badge-ink", "--status-badge-ground"]) {
      const regular = statusBadgeToken(badgeSheet, tone, property, {
        size: "regular",
        compact: false,
      });
      for (const size of statusBadgeSizes) {
        for (const compact of [false, true]) {
          expect(
            statusBadgeToken(badgeSheet, tone, property, { size, compact }),
          ).toBe(regular);
        }
      }
    }
  }
});

test("a ground edited below the contrast its word needs is named, in the schemes it fails in", () => {
  const faint = badgeSheet.replace(
    "--status-badge-ground: var(--wash-pass);",
    "--status-badge-ground: var(--tone-pass);",
  );
  expect(faint).not.toBe(badgeSheet);
  expect(statusBadgeContrastFailures(faint)).toEqual([
    "Light: pass on its ground",
    "Dark: pass on its ground",
  ]);
});

test("the badge sets no text smaller than the type scale's smallest step", () => {
  const sizes = [...badgeSheet.matchAll(/var\(--text-([a-z0-9]+)\)/gu)].map(
    (found) => found[1],
  );
  expect(new Set(sizes)).toEqual(new Set(["sm", "xs"]));
  expect(badgeSheet).not.toMatch(/font-size:(?!\s*var\(--text-)/u);
});
