/**
 * The dialog as a modal, opened from its trigger beside the page it covers:
 * the focus is held inside it, the page behind is hidden and takes no press,
 * Escape and a press on the scrim each close it, and closing returns the focus
 * to what opened it.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import { Dialog } from "../app/browser/ui/Dialog.tsx";
import { Lightbox } from "../app/browser/ui/Lightbox.tsx";
import { turned } from "./screenHarness.tsx";
import { styleless } from "./styleless.ts";
import { renderCopied } from "./copied.tsx";

afterEach(cleanup);

function Page(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main>
        <button type="button">Behind</button>
      </main>
      <Dialog
        title="Edit"
        trigger="Edit"
        open={open}
        onOpenChange={setOpen}
        foot={
          <>
            <button type="button">First</button>
            <button type="button">Last</button>
          </>
        }
      >
        <p>roles</p>
      </Dialog>
    </>
  );
}

async function pageOpened(): Promise<{
  readonly trigger: HTMLElement;
  readonly dialog: HTMLElement;
}> {
  renderCopied(<Page />);
  const trigger = screen.getByRole("button", { name: "Edit" });
  trigger.focus();
  await turned(() => {
    fireEvent.click(trigger);
  });
  return { trigger, dialog: screen.getByRole("dialog", { name: "Edit" }) };
}

test("an open dialog holds the focus: Tab past its last control comes back to its first, and a focus outside is taken back", async () => {
  const { dialog } = await pageOpened();
  expect(dialog.contains(document.activeElement)).toBe(true);
  const last = screen.getByRole("button", { name: "Last" });
  last.focus();
  await turned(() => {
    fireEvent.keyDown(last, { key: "Tab" });
  });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "First" }),
  );
  await turned(() => {
    screen.getByRole("button", { name: "Behind", hidden: true }).focus();
  });
  expect(dialog.contains(document.activeElement)).toBe(true);
  styleless();
});

test("the page behind an open dialog is hidden and takes no press, and is given back on close", async () => {
  const { dialog } = await pageOpened();
  const behind = screen.getByRole("main", { hidden: true });
  expect(behind.closest("[aria-hidden='true']")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Behind" })).toBeNull();
  expect(document.body.style.pointerEvents).toBe("none");
  expect(dialog.closest("[aria-hidden='true']")).toBeNull();
  await turned(() => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
  await turned();
  expect(behind.closest("[aria-hidden='true']")).toBeNull();
  expect(screen.getByRole("button", { name: "Behind" })).toBe(
    behind.firstElementChild,
  );
  expect(document.body.style.pointerEvents).toBe("");
  styleless();
});

test("Escape closes the dialog and returns the focus to its trigger", async () => {
  const { trigger, dialog } = await pageOpened();
  await turned(() => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  styleless();
});

test("a press on the scrim closes the dialog and returns the focus to its trigger", async () => {
  const { trigger, dialog } = await pageOpened();
  const scrim = dialog.parentElement?.previousElementSibling;
  expect(scrim?.classList).toContain("bg-scrim");
  await turned(() => {
    if (scrim === null || scrim === undefined) return;
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  styleless();
});

test("a lightbox opens as the same modal, and closing returns the focus to its image", async () => {
  renderCopied(
    <>
      <main>
        <button type="button">Behind</button>
      </main>
      <Lightbox
        src="data:image/png;base64,QQ=="
        alt="Screenshot"
        className=""
      />
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Screenshot" });
  trigger.focus();
  await turned(() => {
    fireEvent.click(trigger);
  });
  const dialog = screen.getByRole("dialog", { name: "Screenshot" });
  expect(screen.queryByRole("button", { name: "Behind" })).toBeNull();
  await turned(() => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  styleless();
});
