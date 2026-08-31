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
  const drawn = [
    actionStateOf({ ...base }),
    actionStateOf({ ...base, busy: true }),
    actionStateOf({ ...base, refusedBecause: "No" }),
    actionStateOf({ ...base, offered: false }),
  ];
  expect(drawn).toEqual(["ready", "busy", "refused", "absent"]);
  expect([...drawn].sort()).toEqual([...actionStates].sort());
  expect(actionForms).toEqual(["full", "compact"]);
});

/**
 * The state the model needs: a wall whose only exit is revoke must not be
 * given a control that submits a resume into it.
 */
test("an answer the machine does not admit draws no button at all", () => {
  for (const variant of actionForms) {
    const chosen = vi.fn();
    render(
      <ActionWithCost
        action="Resume"
        effect="Nothing to resume"
        more="only Revoke exits this wall"
        offered={false}
        variant={variant}
        onChoose={chosen}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByText("Nothing to resume · only Revoke exits this wall"),
    ).toBeDefined();
    expect(chosen).not.toHaveBeenCalled();
    cleanup();
  }
});

test("an absent action outranks busy and refused, which name a button there is", () => {
  render(
    <ActionWithCost
      action="Resume"
      effect="Nothing to resume"
      offered={false}
      busy
      refusedBecause="Not allowed in this phase"
      onChoose={() => undefined}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText("Not allowed in this phase")).toBeNull();
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

/**
 * `aria-describedby` is an id-reference list, so an action whose word carries a
 * space would split into two references naming nothing.
 */
test("the effect's reference resolves however the action is spelled", () => {
  for (const action of ["Resume", "Add rework"]) {
    const { container } = render(
      <ActionWithCost
        action={action}
        effect="Adds one rework cycle"
        variant="compact"
        onChoose={() => undefined}
      />,
    );
    const described = screen
      .getByRole("button", { name: action })
      .getAttribute("aria-describedby");
    expect(described).not.toBeNull();
    expect(described ?? "").not.toContain(" ");
    expect(
      container.querySelector(`[id="${String(described)}"]`)?.textContent,
    ).toContain("Adds one rework cycle");
    cleanup();
  }
});

test("two actions on one page describe themselves by different ids", () => {
  const { container } = render(
    <>
      <ActionWithCost {...base} variant="compact" />
      <ActionWithCost {...base} action="Revoke" variant="compact" />
    </>,
  );
  const ids = [...container.querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-describedby"),
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});

test("the compact form keeps the effect for a reader who cannot see it", () => {
  const { container } = render(
    <ActionWithCost {...base} variant="compact" more="Not drawn here" />,
  );
  const button = screen.getByRole("button", { name: "Resume" });
  const described = button.getAttribute("aria-describedby");
  expect(described).not.toBeNull();
  const effect = container.querySelector(`[id="${String(described)}"]`);
  expect(effect?.textContent).toContain("Re-runs evaluation from stage 1");
  expect(effect?.classList.contains("visually-hidden")).toBe(true);
  expect(screen.queryByText("Not drawn here")).toBeNull();
});
