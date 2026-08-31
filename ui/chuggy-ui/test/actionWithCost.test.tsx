/**
 * The button and what pressing it does, in every state a mutation can be
 * offered in.
 *
 * A refusal is asserted to be visible text and not a `title`, because a reason
 * a reader must hover for is a reason they will not find; and a refused or busy
 * action is asserted not to fire, because a disabled control that still submits
 * is exactly the defect the state exists to prevent.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  ActionWithCost,
  actionForms,
  actionStateOf,
  actionStates,
} from "../app/browser/ui/ActionWithCost.tsx";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
}));

afterEach(cleanup);

const base = {
  action: "Resume",
  effect: "Re-runs evaluation from stage 1",
  cost: "costs 1 gas",
  onChoose: () => undefined,
};

test("the state is read from the props, over the whole roster", () => {
  expect(actionStateOf({ ...base })).toBe("ready");
  expect(actionStateOf({ ...base, busy: true })).toBe("busy");
  expect(actionStateOf({ ...base, refusedBecause: "No" })).toBe("refused");
  expect(actionStates).toContain("absent");
  expect(actionForms).toEqual(["full", "compact"]);
});

test("a ready action draws its effect and its cost and fires once", () => {
  const chosen = vi.fn();
  const { container } = render(
    <ActionWithCost {...base} onChoose={chosen} more="Keeps the artifact" />,
  );
  expect(screen.getByText(/Re-runs evaluation from stage 1/u)).toBeDefined();
  expect(screen.getByText(/costs 1 gas/u)).toBeDefined();
  expect(screen.getByText("Keeps the artifact")).toBeDefined();
  expect(container.querySelector("[style]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(chosen).toHaveBeenCalledTimes(1);
});

test("a refused action shows the reason as text, disabled, and does not fire", () => {
  const chosen = vi.fn();
  render(
    <ActionWithCost
      action="Add rework"
      effect="Adds one rework cycle"
      refusedBecause="Not available in this release"
      onChoose={chosen}
    />,
  );
  const button = screen.getByRole("button", { name: "Add rework" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.getAttribute("title")).toBeNull();
  const reason = screen.getByText("Not available in this release");
  expect(reason.classList.contains("act-refused")).toBe(true);
  fireEvent.click(button);
  expect(chosen).not.toHaveBeenCalled();
});

test("a busy action is busy, disabled and silent", () => {
  const chosen = vi.fn();
  render(<ActionWithCost {...base} busy onChoose={chosen} />);
  const button = screen.getByRole("button", { name: "Resume" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(chosen).not.toHaveBeenCalled();
});

test("a destructive action is drawn as one", () => {
  render(
    <ActionWithCost
      action="Revoke"
      effect="Parks every dependent ticket"
      danger
      onChoose={() => undefined}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "Revoke" })
      .classList.contains("btn-danger"),
  ).toBe(true);
});

test("the compact form keeps the effect for a reader who cannot see it", () => {
  const { container } = render(
    <ActionWithCost {...base} variant="compact" more="Not drawn here" />,
  );
  const button = screen.getByRole("button", { name: "Resume" });
  const described = button.getAttribute("aria-describedby");
  expect(described).not.toBeNull();
  expect(
    container.querySelector(`#${String(described)}`)?.textContent,
  ).toContain("Re-runs evaluation from stage 1");
  expect(
    container
      .querySelector(`#${String(described)}`)
      ?.classList.contains("visually-hidden"),
  ).toBe(true);
  expect(screen.queryByText("Not drawn here")).toBeNull();
});
