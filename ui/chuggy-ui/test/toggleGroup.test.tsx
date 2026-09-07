/**
 * `ToggleGroup` mounted alone: the roles Radix's single group renders, that
 * exactly one item is checked, and that a press never clears the group.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ToggleGroup } from "../app/browser/ui/ToggleGroup.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

test("one item is checked, a press reaches onChange, and the chosen item does not clear", () => {
  const onChange = vi.fn();
  const { container, rerender } = render(
    <ToggleGroup
      label="Theme"
      options={["System", "Light", "Dark"]}
      value="System"
      onChange={onChange}
    />,
  );
  expect(
    screen
      .getByRole("radiogroup", { name: "Theme" })
      .classList.contains("bg-surface-2"),
  ).toBe(true);
  styleless();
  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(3);
  expect(
    radios.filter((radio) => radio.getAttribute("aria-checked") === "true"),
  ).toHaveLength(1);

  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(onChange).toHaveBeenCalledWith("Dark");
  styleless();

  onChange.mockClear();
  rerender(
    <ToggleGroup
      label="Theme"
      options={["System", "Light", "Dark"]}
      value="Dark"
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(
    screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked"),
  ).toBe("true");

  /** Radix's roving focus sets `outline: none` on the root through the CSSOM,
   * which the policy admits; no item this primitive draws carries a style. */
  expect(container.querySelectorAll("button[style]")).toHaveLength(0);
  styleless();
});
