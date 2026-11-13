/**
 * The count badge: the figure is drawn and hidden from assistive technology,
 * which reads the caller's name for what is counted instead, and the figure's
 * ink clears the text minimum on the badge's ground in both schemes.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  contrastRatio,
  themeContrastTextMin,
  themeSchemes,
} from "../../../src/contract/appearance.ts";
import countSheet from "../app/browser/ui/CountBadge.css?raw";
import { CountBadge } from "../app/browser/ui/CountBadge.tsx";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";
import {
  tokenContrastColour,
  tokenContrastDeclarations,
} from "./tokenContrastColours.ts";

afterEach(cleanup);

test("the figure is drawn and hidden, and the name says what is counted", () => {
  const view = render(<CountBadge count={12} name="12 tickets waiting" />);
  const badge = view.container.querySelector(".count-badge");
  const figure = screen.getByText("12");
  expect(figure.getAttribute("aria-hidden")).toBe("true");
  expect(figure.parentElement).toBe(badge);
  const name = screen.getByText("12 tickets waiting");
  expect(name.className).toBe("visually-hidden");
  expect(name.parentElement).toBe(badge);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("a count of none is still drawn, so a zero reads as a zero and not as an absence", () => {
  render(<CountBadge count={0} name="No tickets waiting" />);
  expect(screen.getByText("0").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByText("No tickets waiting")).toBeDefined();
});

test("the figure's ink clears the text minimum on the badge's ground, in both schemes", () => {
  const badge = document.createElement("span");
  badge.className = "count-badge";
  const rules = sheetRules(countSheet, []);
  const tokenOf = (property: string): string =>
    /^var\(--([a-z0-9-]+)\)$/u.exec(
      sheetDeclared(rules, badge, property),
    )?.[1] ?? "";
  const declared = tokenContrastDeclarations(tokenSheet);
  for (const scheme of themeSchemes) {
    expect(
      contrastRatio(
        tokenContrastColour(declared, scheme, tokenOf("color")),
        tokenContrastColour(declared, scheme, tokenOf("background")),
      ),
    ).toBeGreaterThanOrEqual(themeContrastTextMin);
  }
});
