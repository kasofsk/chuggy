/**
 * A field's bindings: the label drawn and bound to its control, the hint and
 * the error the control is described by, the invalid state an error sets, and
 * the required mark that is a word and not a second name for the box.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { FormField } from "../app/browser/ui/FormField.tsx";
import { Input } from "../app/browser/ui/Input.tsx";
import { Select } from "../app/browser/ui/Select.tsx";
import { Textarea } from "../app/browser/ui/Textarea.tsx";
import { renderCopied } from "./copied.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

const colours = [
  { value: "green", text: "Green" },
  { value: "amber", text: "Amber" },
];

function describedBy(element: HTMLElement): readonly string[] {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "");
}

test("a field draws its label and binds it to the control", () => {
  renderCopied(
    <Input labelShown label="Title" value="" onChange={() => undefined} />,
  );
  const box = screen.getByRole("textbox", { name: "Title" });
  const label = screen.getByText("Title");
  expect(label.tagName).toBe("LABEL");
  expect(label.getAttribute("for")).toBe(box.id);
  expect(box.hasAttribute("aria-label")).toBe(false);
  expect(box.hasAttribute("aria-describedby")).toBe(false);
  expect(box.getAttribute("aria-invalid")).toBe("false");
  expect(box.hasAttribute("aria-required")).toBe(false);
  styleless();
});

test("a field's hint and error describe its control, and the error makes it invalid", () => {
  const { container } = renderCopied(
    <Input
      labelShown
      label="Title"
      hint="Read in the ticket list."
      error="A title is needed."
      value=""
      onChange={() => undefined}
    />,
  );
  const box = screen.getByRole("textbox", { name: "Title" });
  const hint = screen.getByText("Read in the ticket list.");
  const error = screen.getByText("A title is needed.");
  expect(describedBy(box)).toStrictEqual([hint.id, error.id]);
  expect(hint.id).not.toBe(error.id);
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector(".input")?.hasAttribute("data-invalid")).toBe(
    true,
  );
});

test("a field with a hint and no error describes its control by the hint and leaves it valid", () => {
  renderCopied(
    <Input
      labelShown
      label="Title"
      hint="Read in the ticket list."
      value=""
      onChange={() => undefined}
    />,
  );
  const box = screen.getByRole("textbox", { name: "Title" });
  expect(describedBy(box)).toStrictEqual([
    screen.getByText("Read in the ticket list.").id,
  ]);
  expect(box.getAttribute("aria-invalid")).toBe("false");
});

test("a field keeps the description its caller already gave the control", () => {
  renderCopied(
    <>
      <p id="elsewhere">Said elsewhere.</p>
      <Input
        labelShown
        label="Title"
        describedBy="elsewhere"
        error="A title is needed."
        value=""
        onChange={() => undefined}
      />
    </>,
  );
  const box = screen.getByRole("textbox", { name: "Title" });
  expect(describedBy(box)).toStrictEqual([
    "elsewhere",
    screen.getByText("A title is needed.").id,
  ]);
});

test("a required field marks its label with a word that is not part of the control's name", () => {
  renderCopied(
    <Input
      labelShown
      required
      label="Title"
      value=""
      onChange={() => undefined}
    />,
  );
  const box = screen.getByRole("textbox", { name: "Title" });
  expect(box.getAttribute("aria-required")).toBe("true");
  const mark = screen.getByText("Required");
  expect(mark.closest("label")?.getAttribute("for")).toBe(box.id);
  expect(mark.getAttribute("aria-hidden")).toBe("true");
});

test("two fields with the same label bind each control to its own label", () => {
  renderCopied(
    <>
      <Input labelShown label="Name" value="a" onChange={() => undefined} />
      <Input labelShown label="Name" value="b" onChange={() => undefined} />
    </>,
  );
  const boxes = screen.getAllByLabelText<HTMLInputElement>("Name");
  expect(boxes.map((box) => box.value)).toStrictEqual(["a", "b"]);
});

test("a textarea in visible-label mode is bound to its label, hint and error", () => {
  const typed: string[] = [];
  renderCopied(
    <Textarea
      labelShown
      label="Summary"
      hint="One paragraph."
      error="Too long."
      value="x"
      onChange={(value) => typed.push(value)}
    />,
  );
  const box = screen.getByRole("textbox", { name: "Summary" });
  expect(box.tagName).toBe("TEXTAREA");
  expect(describedBy(box)).toStrictEqual([
    screen.getByText("One paragraph.").id,
    screen.getByText("Too long.").id,
  ]);
  expect(box.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(box, { target: { value: "y" } });
  expect(typed).toStrictEqual(["y"]);
});

test("an input and a textarea without a shown label still name themselves and draw no label", () => {
  const { container } = render(
    <>
      <Input label="Tokens" value="" onChange={() => undefined} />
      <Textarea label="Prompt" value="" onChange={() => undefined} />
    </>,
  );
  expect(container.querySelector("label")).toBeNull();
  expect(container.querySelector(".form-field")).toBeNull();
  expect(screen.getByLabelText("Tokens").getAttribute("aria-label")).toBe(
    "Tokens",
  );
  expect(screen.getByLabelText("Prompt").getAttribute("aria-label")).toBe(
    "Prompt",
  );
});

test("a select offers its options and hands up the one chosen", () => {
  const chosen: string[] = [];
  render(
    <Select
      label="Colour"
      value="green"
      options={colours}
      onChange={(value) => chosen.push(value)}
    />,
  );
  const select = screen.getByRole<HTMLSelectElement>("combobox", {
    name: "Colour",
  });
  expect(select.value).toBe("green");
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toStrictEqual(["Green", "Amber"]);
  expect(select.getAttribute("aria-invalid")).toBe("false");
  fireEvent.change(select, { target: { value: "amber" } });
  expect(chosen).toStrictEqual(["amber"]);
  styleless();
});

test("a select in visible-label mode is bound to its label and error and is invalid", () => {
  renderCopied(
    <Select
      labelShown
      label="Colour"
      error="Choose one."
      value="green"
      options={colours}
      onChange={() => undefined}
    />,
  );
  const select = screen.getByRole("combobox", { name: "Colour" });
  expect(describedBy(select)).toStrictEqual([
    screen.getByText("Choose one.").id,
  ]);
  expect(select.getAttribute("aria-invalid")).toBe("true");
  expect(select.hasAttribute("data-invalid")).toBe(true);
});

test("a field draws any control it is handed with the bindings it gives", () => {
  renderCopied(
    <FormField label="Due" hint="A day." invalid>
      {(binding) => (
        <input
          id={binding.id}
          aria-describedby={binding.describedBy}
          aria-invalid={binding.invalid}
        />
      )}
    </FormField>,
  );
  const box = screen.getByLabelText("Due");
  expect(describedBy(box)).toStrictEqual([screen.getByText("A day.").id]);
  expect(box.getAttribute("aria-invalid")).toBe("true");
});
