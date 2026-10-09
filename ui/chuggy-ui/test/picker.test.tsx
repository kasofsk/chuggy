/**
 * The picker, mounted alone, over the property the served policy turns on: an
 * open menu that has appended no `<style>` element and has not locked the body.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { Picker } from "../app/browser/ui/Picker.tsx";
import { styleless } from "./styleless.ts";

const projects = [
  { value: "acme/atlas", text: "acme / atlas" },
  { value: "acme/beta", text: "acme / beta" },
];

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(cleanup);

test("the trigger carries the label and shows the chosen option's text", () => {
  const view = render(
    <Picker
      label="Project"
      value="acme/beta"
      options={projects}
      onChoose={() => undefined}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Project acme / beta" });
  expect(trigger).toBeDefined();
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("an open menu is radio items with one checked, and appends no style", async () => {
  const view = render(
    <Picker
      label="Project"
      value="acme/atlas"
      options={projects}
      onChoose={() => undefined}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  const items = screen.getAllByRole("menuitemradio");
  expect(items.map((item) => item.textContent)).toEqual([
    "acme / atlas",
    "acme / beta",
  ]);
  expect(
    items.filter((item) => item.getAttribute("aria-checked") === "true"),
  ).toHaveLength(1);
  styleless();
  expect(document.body.style.pointerEvents).toBe("");
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("choosing another option reaches the caller with its value", async () => {
  const chosen: string[] = [];
  render(
    <Picker
      label="Project"
      value="acme/atlas"
      options={projects}
      onChoose={(value) => {
        chosen.push(value);
      }}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "acme / beta" }));
  expect(chosen).toEqual(["acme/beta"]);
  styleless();
});

test.each([
  ["its trigger's middle where its caller names no edge", undefined, "center"],
  ["the edge of its trigger its caller names", "start", "start"],
] as const)("an open menu lines up with %s", async (_edge, align, drawn) => {
  render(
    <Picker
      label="Project"
      value="acme/atlas"
      options={projects}
      {...(align === undefined ? {} : { align })}
      onChoose={() => undefined}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^Project / }), {
    key: "ArrowDown",
  });
  expect((await screen.findByRole("menu")).getAttribute("data-align")).toBe(
    drawn,
  );
  styleless();
});

/** A trigger takes the width its place gives it, so the chosen text is clipped
 * to that and the hint is where the whole of it stays reachable. */
test("the trigger may be narrower than its text, which it clips, and focusing it reveals the hint", async () => {
  const view = render(
    <Picker
      label="Repository"
      value="https://forge.test/acme/atlas.git"
      options={[
        { value: "https://forge.test/acme/atlas.git", text: "acme/atlas" },
      ]}
      hint="https://forge.test/acme/atlas.git"
      onChoose={() => undefined}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Repository acme/atlas" });
  expect(trigger.classList.contains("min-w-0")).toBe(true);
  expect(screen.getByText("acme/atlas").classList.contains("truncate")).toBe(
    true,
  );
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "https://forge.test/acme/atlas.git",
  );
  styleless();
  expect(view.container.querySelector("[style]")).toBeNull();
});
