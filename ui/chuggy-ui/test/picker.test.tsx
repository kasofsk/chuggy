/**
 * The picker, mounted alone, over the property the served policy turns on: an
 * open menu that has appended no `<style>` element and has not locked the body.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, test } from "vitest";

import { Picker } from "../app/browser/ui/Picker.tsx";

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
  const trigger = screen.getByRole("button", { name: "Project" });
  expect(trigger.textContent).toBe("acme / beta");
  expect(view.container.querySelector("[style]")).toBeNull();
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
  fireEvent.keyDown(screen.getByRole("button", { name: "Project" }), {
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
  expect(document.querySelectorAll("style")).toHaveLength(0);
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
  fireEvent.keyDown(screen.getByRole("button", { name: "Project" }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "acme / beta" }));
  expect(chosen).toEqual(["acme/beta"]);
});
