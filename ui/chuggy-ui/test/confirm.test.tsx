/**
 * The ask before an end that cannot be undone: a group named by its question,
 * its one line, and two buttons that each do only their own thing — and once
 * the end has been sent, only the busy one, which does nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Confirm } from "../app/browser/ui/Confirm.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
});

function drawn(busy: boolean): {
  readonly confirmed: ReturnType<typeof vi.fn>;
  readonly cancelled: ReturnType<typeof vi.fn>;
} {
  const confirmed = vi.fn();
  const cancelled = vi.fn();
  render(
    <Confirm
      question="End this?"
      confirm="End it"
      busy={busy}
      onConfirm={confirmed}
      onCancel={cancelled}
    >
      Ends it for good.
    </Confirm>,
  );
  return { confirmed, cancelled };
}

test("the ask is a group named by its question, saying its one line", () => {
  drawn(false);
  const group = screen.getByRole("group", { name: "End this?" });
  expect(group.querySelector("p")?.textContent).toBe("Ends it for good.");
  expect(group.querySelector("[style]")).toBeNull();
});

test("Cancel and the danger button each answer once and only for themselves", () => {
  const { confirmed, cancelled } = drawn(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(confirmed).not.toHaveBeenCalled();

  const end = screen.getByRole("button", { name: "End it" });
  expect(end.classList.contains("btn-danger")).toBe(true);
  fireEvent.click(end);
  expect(confirmed).toHaveBeenCalledTimes(1);
  expect(cancelled).toHaveBeenCalledTimes(1);
});

test("once sent, the ask is busy, its button silent and Cancel gone", () => {
  const { confirmed } = drawn(true);
  const end = screen.getByRole("button", { name: "End it" });
  expect(end.getAttribute("aria-busy")).toBe("true");
  expect(end.hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  fireEvent.click(end);
  expect(confirmed).not.toHaveBeenCalled();
});
