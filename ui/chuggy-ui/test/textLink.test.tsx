/**
 * The text link: drawn as an anchor carrying the sheet's class and no other,
 * and a finger's size on a narrow screen only. The router is stubbed so the
 * link is drawn with no provider around it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { TextLink } from "../app/browser/ui/TextLink.tsx";
import textLinkSheet from "../app/browser/ui/TextLink.css?raw";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: (props: object) => ReactNode) => component,
}));

afterEach(cleanup);

function textLinkDrawn(): HTMLAnchorElement {
  const { container } = render(<TextLink to="/">somewhere</TextLink>);
  const drawn = container.querySelector("a");
  if (drawn === null) throw new Error("the text link drew no anchor");
  return drawn;
}

test("a text link is an anchor with the sheet's class, and appends no sheet", () => {
  const drawn = textLinkDrawn();
  expect(drawn.textContent).toBe("somewhere");
  expect(drawn.className).toBe("text-link");
  styleless();
});

test("a text link is a finger's height and width on a narrow screen, and the line's size otherwise", () => {
  const drawn = textLinkDrawn();
  const declared = (property: string, conditions: readonly string[]) =>
    sheetDeclared(sheetRules(textLinkSheet, conditions), drawn, property);
  for (const property of ["min-height", "min-width"]) {
    expect(declared(property, [])).toBe("");
    expect(declared(property, [sheetNarrowCondition])).toBe(
      "var(--height-touch)",
    );
  }
});
