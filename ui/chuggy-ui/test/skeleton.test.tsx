/**
 * A skeleton over every shape it claims: a busy region a reader who does not
 * see the page hears as its label, blocks hidden from that reader, drawn on
 * the surface tokens and on a pulse reduced motion stills.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Skeleton, skeletonShapes } from "../app/browser/ui/Skeleton.tsx";
import skeletonSheet from "../app/browser/ui/Skeleton.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

test("a skeleton is a busy region named by its label, whose blocks no reader hears", () => {
  for (const shape of skeletonShapes) {
    const { container } = render(<Skeleton shape={shape} label="Loading…" />);
    const region = container.firstElementChild;
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(region?.textContent).toBe("Loading…");
    expect(
      screen.getByText("Loading…").classList.contains("visually-hidden"),
    ).toBe(true);
    const blocks = [...container.querySelectorAll(".skeleton-block")];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks)
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
    styleless();
    cleanup();
  }
});

test("each shape draws its own blocks", () => {
  const drawn = skeletonShapes.map((shape) => {
    const { container } = render(<Skeleton shape={shape} label="Loading…" />);
    const classes = [...container.querySelectorAll(".skeleton-shape *")].map(
      (block) => block.className,
    );
    cleanup();
    return classes;
  });
  expect(drawn).toStrictEqual([
    ["skeleton-block skeleton-line"],
    ["skeleton-block skeleton-row"],
    [
      "skeleton-card",
      "skeleton-block skeleton-line",
      "skeleton-block skeleton-row",
    ],
  ]);
});

test("a skeleton's blocks stand on the surface tokens and pulse on a duration reduced motion sets to zero", () => {
  const rules = sheetRules(skeletonSheet, []);
  const { container } = render(<Skeleton shape="card" label="Loading…" />);
  const card = container.querySelector(".skeleton-card");
  const block = container.querySelector(".skeleton-block");
  if (card === null || block === null) throw new Error("no card is drawn");
  expect(sheetDeclared(rules, card, "background")).toBe("var(--surface-1)");
  expect(sheetDeclared(rules, block, "background")).toBe("var(--surface-2)");
  expect(sheetDeclared(rules, block, "animation").replace(/\s+/gu, " ")).toBe(
    "skeleton-pulse var(--duration-pulse) var(--ease-out) infinite alternate",
  );
  const still = sheetRules(tokenSheet, ["(prefers-reduced-motion: reduce)"]);
  expect(
    sheetDeclared(still, document.documentElement, "--duration-pulse"),
  ).toBe("0ms");
});
