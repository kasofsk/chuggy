/**
 * The chip over both its shapes: one that stands, drawn as the neutral pill
 * with no control, and one that can be taken away, ending in a button named by
 * its caller that removes it only while it may.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Chip } from "../app/browser/ui/Chip.tsx";
import { Pill } from "../app/browser/ui/Pill.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
});

test("a standing chip is its words in the neutral pill's look, with no control", () => {
  const view = render(
    <>
      <Chip>Site admins</Chip>
      <Pill tone="neutral">Default</Pill>
    </>,
  );
  const chip = screen.getByText("Site admins").closest(".chip");
  const pill = screen.getByText("Default");
  expect(chip?.textContent).toBe("Site admins");
  expect(
    pill.className.split(" ").every((name) => chip?.classList.contains(name)),
  ).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("a chip that can be taken away ends in a button named by its caller, which removes it", () => {
  const removed = vi.fn();
  render(
    <Chip removal={{ name: "Remove Ada from Admins", onRemove: removed }}>
      Ada
    </Chip>,
  );
  const button = screen.getByRole("button", { name: "Remove Ada from Admins" });
  expect(button.closest(".chip")?.firstElementChild?.textContent).toBe("Ada");
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(button);
  expect(removed).toHaveBeenCalledTimes(1);
});

test("a chip whose removal is disabled keeps its button and removes nothing", () => {
  const removed = vi.fn();
  render(
    <Chip
      removal={{
        name: "Remove Ada from Admins",
        disabled: true,
        onRemove: removed,
      }}
    >
      Ada
    </Chip>,
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Remove Ada from Admins",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(removed).not.toHaveBeenCalled();
});
