/**
 * The dialog mounted open: what jsdom can see of a dialog that is never taller
 * than the viewport, since it lays nothing out. The frame is fixed with an
 * inset at both edges, the dialog fills at most that frame, and the caller's
 * body is the one part that shrinks and scrolls, between a title and a foot
 * that stay outside it: Close, or the actions a caller hands it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Dialog } from "../app/browser/ui/Dialog.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

function classesOf(element: Element | null): readonly string[] {
  return element === null ? [] : [...element.classList];
}

test("the body scrolls inside a dialog bounded by the viewport, between its title and Close", () => {
  render(
    <Dialog title="Add" trigger="Add" open onOpenChange={() => undefined}>
      <p>first</p>
      <p>last</p>
    </Dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Add" });
  expect(classesOf(dialog.parentElement)).toEqual(
    expect.arrayContaining(["fixed", "inset-y-6"]),
  );
  expect(classesOf(dialog)).toEqual(
    expect.arrayContaining(["flex", "flex-col", "max-h-full"]),
  );
  const [title, body, close] = [...dialog.children];
  expect(title?.textContent).toBe("Add");
  expect(close?.textContent).toBe("Close");
  expect(classesOf(body ?? null)).toEqual(
    expect.arrayContaining(["dialog-body", "min-h-0", "overflow-y-auto"]),
  );
  expect(body?.textContent).toBe("firstlast");
  expect(dialog.children).toHaveLength(3);
  styleless();
});

test("a caller's foot stands in place of Close, at the width a form takes", () => {
  render(
    <Dialog
      wide
      title="Invite"
      trigger="Invite"
      open
      onOpenChange={() => undefined}
      foot={<button type="button">Send</button>}
    >
      <p>form</p>
    </Dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Invite" });
  expect(classesOf(dialog)).toContain("max-w-measure");
  expect(classesOf(dialog)).not.toContain("max-w-aside");
  const foot = dialog.children[2];
  expect(foot?.textContent).toBe("Send");
  expect(classesOf(foot ?? null)).toContain("justify-end");
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(dialog.children).toHaveLength(3);
  styleless();
});

test("a trigger is named by its word, or by the name a caller gives it", () => {
  render(
    <>
      <Dialog
        title="One"
        trigger="Edit"
        open={false}
        onOpenChange={() => undefined}
      >
        <p>one</p>
      </Dialog>
      <Dialog
        title="Two"
        trigger="Edit"
        triggerNamed="Edit ada"
        open={false}
        onOpenChange={() => undefined}
      >
        <p>two</p>
      </Dialog>
    </>,
  );
  expect(
    screen
      .getAllByRole("button")
      .map((button) => [button.textContent, button.getAttribute("aria-label")]),
  ).toStrictEqual([
    ["Edit", null],
    ["Edit", "Edit ada"],
  ]);
});
