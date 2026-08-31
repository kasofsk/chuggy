/**
 * The notice over its roster and its two forms, and what a reader is told when
 * one arrives.
 *
 * The block form is a word with a reason under it; the inline form is the one
 * line a panel draws in place of the data it could not get.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Notice, noticeTones } from "../app/browser/ui/Notice.tsx";

afterEach(cleanup);

test("every tone draws its own class in both forms", () => {
  for (const tone of noticeTones) {
    const view = render(
      <>
        <Notice tone={tone} heading="Parked" detail="Rework budget exhausted" />
        <Notice tone={tone} inline detail="Failed to load" />
      </>,
    );
    const drawn = view.container.querySelectorAll(`.notice-${tone}`);
    expect(drawn.length).toBe(2);
    expect(drawn[1]?.classList.contains("notice-inline")).toBe(true);
    expect(drawn[0]?.classList.contains("notice-inline")).toBe(false);
    cleanup();
  }
});

test("the block form draws the word, the reason and at most one more line", () => {
  const view = render(
    <Notice
      tone="parked"
      role="status"
      heading="Parked"
      detail="Rework budget exhausted"
      more="Stage 1 of 2 failed"
    />,
  );
  expect(screen.getByRole("status")).toBeDefined();
  expect(view.container.querySelector(".notice-head")?.textContent).toBe(
    "Parked",
  );
  expect(view.container.querySelector(".notice-detail")?.textContent).toBe(
    "Rework budget exhausted",
  );
  expect(view.container.querySelector(".notice-more")?.textContent).toBe(
    "Stage 1 of 2 failed",
  );
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("a notice with no heading draws none, and the inline form has none at all", () => {
  const view = render(
    <>
      <Notice tone="info" detail="Loading…" />
      <Notice tone="danger" inline detail="Failed to load · API unreachable" />
    </>,
  );
  expect(view.container.querySelector(".notice-head")).toBeNull();
  expect(screen.getByText("Failed to load · API unreachable").tagName).toBe(
    "P",
  );
});
