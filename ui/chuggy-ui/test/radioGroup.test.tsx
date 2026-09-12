/**
 * The radio group, mounted alone: every option on screen at once, each named by
 * the label beside it, and no `<style>` element the served policy would refuse.
 *
 * A described option is checked through the reference rather than through the
 * line, because a line drawn on screen that nothing points at is read by nobody
 * using a screen reader.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { RadioGroup } from "../app/browser/ui/RadioGroup.tsx";
import { styleless } from "./styleless.ts";

const visibilities = [
  { value: "private", text: "Private" },
  { value: "public", text: "Public" },
];

const landings = [
  {
    value: "Push",
    text: "Push",
    description: "Commits straight onto the target branch",
  },
  {
    value: "PullRequest",
    text: "Pull request",
    description: "Opens a pull request into the target branch",
  },
];

/** What a reader is told about an option, followed from the option itself. */
function describedText(name: string): string | undefined {
  const referenced = screen
    .getByRole("radio", { name })
    .getAttribute("aria-describedby");
  if (referenced === null) return undefined;
  expect(referenced).not.toContain(" ");
  return document.getElementById(referenced)?.textContent ?? undefined;
}

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

test("a described option is described, by a reference that resolves", () => {
  render(
    <RadioGroup
      label="Landing"
      value="Push"
      options={landings}
      onChoose={() => undefined}
    />,
  );
  expect(describedText("Push")).toBe("Commits straight onto the target branch");
  expect(describedText("Pull request")).toBe(
    "Opens a pull request into the target branch",
  );
  styleless();
});

/** The undescribed roster is what `CreateRepository` draws, and it must not
 * gain an empty second line under each label. */
test("a roster describing nothing draws no description at all", () => {
  render(
    <RadioGroup
      label="Visibility"
      value="private"
      options={visibilities}
      onChoose={() => undefined}
    />,
  );
  expect(describedText("Private")).toBe(undefined);
  expect(describedText("Public")).toBe(undefined);
  expect(document.querySelectorAll(".radio-about").length).toBe(0);
});

/** The landing section reads before it is edited, so the group is drawn
 * disabled rather than withheld: the choice in force is still on screen. */
test("a disabled group still says which option is chosen, and takes none", () => {
  const chosen: string[] = [];
  render(
    <RadioGroup
      label="Landing"
      value="Push"
      options={landings}
      disabled
      onChoose={(value) => chosen.push(value)}
    />,
  );
  const other = screen.getByRole("radio", { name: "Pull request" });
  expect(other.getAttribute("data-disabled")).not.toBe(null);
  fireEvent.click(other);
  expect(chosen).toStrictEqual([]);
  expect(
    screen.getByRole("radio", { name: "Push" }).getAttribute("aria-checked"),
  ).toBe("true");
});
