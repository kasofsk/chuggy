/**
 * The checkbox mounted: a box named by the label drawn beside it or by one
 * that only names it, drawn as it is held, answering a press with what the
 * press asks for and never changing itself, and taking no press where it is
 * only shown.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Checkbox } from "../app/browser/ui/Checkbox.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

function checked(name: string): string | null {
  return screen.getByRole("checkbox", { name }).getAttribute("aria-checked");
}

test("a box is named by its label, drawn as held, and answers a press with what it asks for", () => {
  const asked: boolean[] = [];
  const answer = (held: boolean): void => {
    asked.push(held);
  };
  render(
    <>
      <Checkbox label="Admin" checked={false} onChange={answer} />
      <Checkbox label="Member" checked onChange={answer} />
    </>,
  );
  expect([checked("Admin"), checked("Member")]).toStrictEqual([
    "false",
    "true",
  ]);
  expect(screen.getByText("Admin").tagName).toBe("LABEL");
  fireEvent.click(screen.getByRole("checkbox", { name: "Admin" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Member" }));
  expect(asked).toStrictEqual([true, false]);
  expect([checked("Admin"), checked("Member")]).toStrictEqual([
    "false",
    "true",
  ]);
  styleless();
});

test("a press on the label is a press on its box", () => {
  const asked: boolean[] = [];
  render(
    <Checkbox
      label="Hosted runs"
      checked={false}
      onChange={(held) => {
        asked.push(held);
      }}
    />,
  );
  fireEvent.click(screen.getByText("Hosted runs"));
  expect(asked).toStrictEqual([true]);
});

test("a bare box is named by its label and draws none", () => {
  render(
    <Checkbox bare label="atlas Admin" checked onChange={() => undefined} />,
  );
  expect(checked("atlas Admin")).toBe("true");
  expect(screen.queryByText("atlas Admin")).toBeNull();
});

test("a box that is only shown is drawn as held and takes no press", () => {
  const asked: boolean[] = [];
  render(
    <Checkbox
      label="Admin"
      checked
      disabled
      onChange={(held) => {
        asked.push(held);
      }}
    />,
  );
  const box = screen.getByRole<HTMLButtonElement>("checkbox", {
    name: "Admin",
  });
  expect(box.disabled).toBe(true);
  expect(checked("Admin")).toBe("true");
  fireEvent.click(box);
  expect(asked).toStrictEqual([]);
});
