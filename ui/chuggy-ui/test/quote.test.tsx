/**
 * The quote block over its roster and its bare form: a scroll-capped block of
 * text, with an optional rail marking which side of a conversation it is.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Quote, quoteRails } from "../app/browser/ui/Quote.tsx";

afterEach(cleanup);

test("every rail draws its own class over the base one", () => {
  for (const rail of quoteRails) {
    const view = render(<Quote rail={rail}>{rail}</Quote>);
    const drawn = screen.getByText(rail);
    expect(drawn.tagName).toBe("PRE");
    expect(drawn.classList.contains("quote")).toBe(true);
    expect(drawn.classList.contains(`quote-${rail}`)).toBe(true);
    expect(view.container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("a bare quote carries no rail class", () => {
  render(<Quote>plain text</Quote>);
  const drawn = screen.getByText("plain text");
  expect(drawn.classList.contains("quote")).toBe(true);
  expect(drawn.className).toBe("quote");
});
