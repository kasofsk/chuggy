/**
 * The cell every measured number is drawn in.
 *
 * Every kind is rendered, because the roster is what the primitive claims to be
 * total over; the basis tag and the hover are checked as themselves, because
 * each is a fact the reader would otherwise have to take on trust.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { Figure as FigureValue } from "../app/core/figures.ts";
import { figureKinds } from "../app/core/figures.ts";
import { Figure, figureBasisTitle } from "../app/browser/ui/Figure.tsx";

afterEach(cleanup);

const everyKind: readonly FigureValue[] = [
  { kind: "Cost", text: "$0.42", basis: "list" },
  { kind: "Tokens", text: "9.1k tok" },
  { kind: "Duration", text: "4m 12s" },
  { kind: "Instant", text: "10:12", iso: "2026-08-27T10:12:00.000Z" },
  {
    kind: "Span",
    start: "10:19",
    end: "10:49",
    length: "30m",
    open: false,
    title: "a → b",
  },
  { kind: "Absent", why: "No run figures yet" },
];

test("the roster and the cases the suite draws are the same set", () => {
  expect(everyKind.map((figure) => figure.kind).sort()).toEqual(
    [...figureKinds].sort(),
  );
});

test("every kind draws in the figure cell and emits no style attribute", () => {
  for (const figure of everyKind) {
    const { container } = render(<Figure figure={figure} />);
    expect(container.querySelector(".fig")).not.toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("a dollar carries its basis, and the tag says what a list price is not", () => {
  render(<Figure figure={{ kind: "Cost", text: "$0.42", basis: "list" }} />);
  const tag = screen.getByText("list");
  expect(tag.classList.contains("fig-basis")).toBe(true);
  expect(tag.getAttribute("title")).toBe(figureBasisTitle);
});

test("an instant hovers its full ISO and an absence hovers its reason", () => {
  const { container } = render(
    <Figure
      figure={{ kind: "Instant", text: "10:12", iso: "2026-08-27T10:12:00Z" }}
    />,
  );
  expect(container.querySelector(".fig")?.getAttribute("title")).toBe(
    "2026-08-27T10:12:00Z",
  );
  cleanup();
  render(<Figure figure={{ kind: "Absent", why: "No run figures yet" }} />);
  const absent = screen.getByTitle("No run figures yet");
  expect(absent.textContent).toBe("—");
  expect(absent.classList.contains("fig-dim")).toBe(true);
});

test("an open span is drawn live and a closed one is not", () => {
  const open: FigureValue = {
    kind: "Span",
    start: "10:19",
    end: "running",
    length: "48m so far",
    open: true,
    title: "a → running",
  };
  const { container } = render(<Figure figure={open} />);
  const drawn = container.querySelector(".fig");
  expect(drawn?.classList.contains("fig-live")).toBe(true);
  expect(drawn?.textContent).toContain("10:19 → running");
  expect(drawn?.textContent).toContain("48m so far");
  cleanup();
  const closed = render(
    <Figure figure={{ ...open, end: "10:49", length: "30m", open: false }} />,
  );
  expect(
    closed.container.querySelector(".fig")?.classList.contains("fig-live"),
  ).toBe(false);
});
