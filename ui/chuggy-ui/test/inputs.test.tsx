/**
 * The two boxes a reader types into, and the section chrome they sit in.
 *
 * What is asserted is the accessible shape and the states an attribute carries
 * — the label the box answers to, the refusal, the unit — because those are
 * what a stylesheet cannot supply and what every case of the settings page
 * reaches the box through.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Input } from "../app/browser/ui/Input.tsx";
import { Panel } from "../app/browser/ui/Panel.tsx";
import { Textarea, textareaRowsLeast } from "../app/browser/ui/Textarea.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

test("an input answers to its label, carries its unit and says it was refused", () => {
  const typed: string[] = [];
  render(
    <Input
      numeric
      label="Tokens"
      unit="tokens"
      value="500"
      placeholder="200000"
      invalid
      onChange={(value) => typed.push(value)}
    />,
  );
  const box = screen.getByLabelText<HTMLInputElement>("Tokens");
  expect(box.value).toBe("500");
  expect(box.placeholder).toBe("200000");
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(box.getAttribute("inputmode")).toBe("numeric");
  expect(screen.getByText("tokens").classList.contains("input-unit")).toBe(
    true,
  );
  fireEvent.change(box, { target: { value: "600" } });
  expect(typed).toStrictEqual(["600"]);
  styleless();
});

/** A box with no unit draws none rather than an empty one, and a box that is
 * not numeric is not aligned as though it were. */
test("an input with no unit and no numeric flag draws neither", () => {
  const { container } = render(
    <Input label="Title" value="" onChange={() => undefined} />,
  );
  expect(container.querySelector(".input-unit")).toBeNull();
  expect(container.querySelector(".input")?.hasAttribute("data-numeric")).toBe(
    false,
  );
  expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe(
    "false",
  );
});

/** `field-sizing` grows the box in a browser that has it; `rows` is what stops
 * a browser without it opening the box at its own default of two lines. */
test("a textarea opens at the fallback height and marks its own face", () => {
  render(
    <Textarea
      mono
      label="Base prompt"
      value="choose the next ticket"
      onChange={() => undefined}
    />,
  );
  const box = screen.getByLabelText<HTMLTextAreaElement>("Base prompt");
  expect(box.rows).toBe(textareaRowsLeast);
  expect(box.hasAttribute("data-mono")).toBe(true);
  expect(box.value).toBe("choose the next ticket");
  styleless();
});

test("a proportional textarea is not marked as mono", () => {
  render(<Textarea label="North Star" value="" onChange={() => undefined} />);
  expect(screen.getByLabelText("North Star").hasAttribute("data-mono")).toBe(
    false,
  );
});

/** The section variant is a settings card: the line under the title saying what
 * the section holds, and the foot its own actions sit in. Neither is drawn by a
 * panel that was not given one, which is what keeps the variant compatible. */
test("a section panel draws its about line and its foot", () => {
  const { container } = render(
    <Panel
      variant="section"
      title="Limits"
      about="What one decision may spend."
      foot={<button type="button">Save changes</button>}
    >
      <p>Tokens</p>
    </Panel>,
  );
  const region = screen.getByRole("region", { name: "Limits" });
  expect(region.classList.contains("rounded-2")).toBe(true);
  expect(screen.getByText("What one decision may spend.")).toBeDefined();
  expect(container.querySelector("footer.panel-foot")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
  styleless();
});

test("a panel given no about line and no foot draws neither", () => {
  const { container } = render(
    <Panel title="Budgets">
      <p>Rework</p>
    </Panel>,
  );
  expect(container.querySelector(".panel-about")).toBeNull();
  expect(container.querySelector("footer.panel-foot")).toBeNull();
});
