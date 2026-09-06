/**
 * The tooltip: a focusable trigger, hover text a screen reader can also find,
 * and no runtime `<style>` element while it is open — the served policy
 * refuses one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Tooltip } from "../app/browser/ui/Tooltip.tsx";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the child is the trigger, focusable, and the text appears on focus", async () => {
  const { container } = render(
    <Tooltip text="the full reason">
      <span>short</span>
    </Tooltip>,
  );
  const trigger = screen.getByText("short");
  expect(trigger.getAttribute("tabindex")).toBe("0");
  fireEvent.focus(trigger);
  const content = await screen.findByRole("tooltip");
  expect(content.textContent).toBe("the full reason");
  expect(document.querySelectorAll("style")).toHaveLength(0);
  expect(container.querySelector("[style]")).toBeNull();
});

test("absent text draws the child alone", () => {
  render(
    <Tooltip text={undefined}>
      <span>plain</span>
    </Tooltip>,
  );
  const drawn = screen.getByText("plain");
  expect(drawn.hasAttribute("tabindex")).toBe(false);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
