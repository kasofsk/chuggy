/**
 * The radio group, mounted alone: every option on screen at once, each named by
 * the label beside it, and no `<style>` element the served policy would refuse.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { RadioGroup } from "../app/browser/ui/RadioGroup.tsx";
import { styleless } from "./styleless.ts";

const visibilities = [
  { value: "private", text: "Private" },
  { value: "public", text: "Public" },
];

afterEach(cleanup);

test("every option is a radio named by its own label, one of them checked", () => {
  render(
    <RadioGroup
      label="Visibility"
      value="private"
      options={visibilities}
      onChoose={() => undefined}
    />,
  );
  expect(screen.getByRole("radiogroup", { name: "Visibility" })).toBeTruthy();
  const chosen = screen.getByRole("radio", { name: "Private" });
  expect(chosen.getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByRole("radio", { name: "Public" }).getAttribute("aria-checked"),
  ).toBe("false");
  styleless();
});

test("pressing an option answers the value the roster gave it", () => {
  const chosen: string[] = [];
  render(
    <RadioGroup
      label="Visibility"
      value="private"
      options={visibilities}
      onChoose={(value) => chosen.push(value)}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Public" }));
  expect(chosen).toStrictEqual(["public"]);
});
