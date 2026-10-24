/**
 * Whether an element is as wide as a breakpoint, which is how the shell asks
 * its pages' column whether the details fit beside a page: read when the
 * element is drawn and whenever it resizes, in the root's `em`, against a
 * threshold whose aside is the width the sheets give it.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  useElementAtLeastEm,
  viewportAsideEm,
  viewportColumnAsideEm,
  viewportNarrowEm,
} from "../app/browser/shell/viewport.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";

afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An observer that tells what it observes only when a case says so. */
function observerHeld(): (width: number) => void {
  const held: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        held.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  return (width) => {
    act(() => {
      for (const callback of held)
        callback(
          [{ contentRect: { width } } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
    });
  };
}

function measuredAt(width: number): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
  } as DOMRect);
}

function Probe(props: { readonly em: number }): ReactNode {
  const [held, wide] = useElementAtLeastEm(props.em);
  return <div ref={held}>{wide ? "wide" : "narrow"}</div>;
}

test("an element is measured when it is drawn and again whenever it resizes", () => {
  document.documentElement.style.fontSize = "16px";
  const resized = observerHeld();
  measuredAt(40 * 16);
  render(<Probe em={40} />);
  expect(screen.getByText("wide")).toBeDefined();
  resized(40 * 16 - 1);
  expect(screen.getByText("narrow")).toBeDefined();
  resized(50 * 16);
  expect(screen.getByText("wide")).toBeDefined();
});

/** A breakpoint's `em` is the root's, as a media query's is, so a reader who
 * set a larger root size needs a wider element for the same answer. */
test("the width is read in the root's em", () => {
  document.documentElement.style.fontSize = "20px";
  observerHeld();
  measuredAt(40 * 16);
  render(<Probe em={40} />);
  expect(screen.getByText("narrow")).toBeDefined();
});

test.each(["", "0px"])(
  "a root whose size reads as %j leaves every element narrow",
  (fontSize) => {
    document.documentElement.style.fontSize = "";
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize,
    } as CSSStyleDeclaration);
    observerHeld();
    measuredAt(400 * 16);
    render(<Probe em={40} />);
    expect(screen.getByText("narrow")).toBeDefined();
  },
);

test("the details fit beside a page in a column that holds the page at its narrow width and the aside at the sheets' width", () => {
  const rules = sheetRules(tokenSheet, []);
  expect(sheetDeclared(rules, document.documentElement, "--width-aside")).toBe(
    `${String(viewportAsideEm)}rem`,
  );
  expect(viewportColumnAsideEm).toBe(viewportNarrowEm + viewportAsideEm);
});
