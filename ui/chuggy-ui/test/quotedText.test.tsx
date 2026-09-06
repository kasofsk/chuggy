/**
 * The quoted-text block over its whole roster: no rail draws a bare block, and
 * each rail draws its own class beside it — the one thing that tells what a
 * member said from what came back.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { QuotedText, quotedTextRails } from "../app/browser/ui/QuotedText.tsx";

afterEach(cleanup);

test("a block with no rail draws the bare class only", () => {
  render(<QuotedText>plain text</QuotedText>);
  const drawn = screen.getByText("plain text");
  expect(drawn.tagName).toBe("PRE");
  expect(drawn.classList.value).toBe("quoted-text");
});

test("every rail draws its own class beside the bare one", () => {
  for (const rail of quotedTextRails) {
    const view = render(<QuotedText rail={rail}>{rail}</QuotedText>);
    const drawn = screen.getByText(rail);
    expect(drawn.classList.contains("quoted-text")).toBe(true);
    expect(drawn.classList.contains(`quoted-text-${rail}`)).toBe(true);
    expect(view.container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("the said and answer rails draw different classes from one another", () => {
  render(
    <>
      <QuotedText rail="said">said</QuotedText>
      <QuotedText rail="answer">answer</QuotedText>
    </>,
  );
  expect(
    screen.getByText("said").classList.contains("quoted-text-answer"),
  ).toBe(false);
  expect(
    screen.getByText("answer").classList.contains("quoted-text-said"),
  ).toBe(false);
});
