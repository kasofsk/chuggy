/**
 * The quoted-text block over its roster: no rail for a plain entry, and the
 * two rails a turn's two sides draw to tell them apart.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Quote, quoteRails } from "../app/browser/ui/Quote.tsx";

afterEach(cleanup);

test("a quote with no rail draws none", () => {
  render(<Quote>a member's own line</Quote>);
  const drawn = screen.getByText("a member's own line");
  expect(drawn.tagName).toBe("PRE");
  expect(drawn.classList.value).toBe("quote");
});

test("each rail draws its own class, and the roster is what it is total over", () => {
  for (const rail of quoteRails) {
    const { container } = render(<Quote rail={rail}>{rail}</Quote>);
    const drawn = container.querySelector(".quote");
    expect(drawn?.classList.contains(`quote-${rail}`)).toBe(true);
    cleanup();
  }
  expect(quoteRails).toEqual(["said", "answer"]);
});
