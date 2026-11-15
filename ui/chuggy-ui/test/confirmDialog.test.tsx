/**
 * The confirm dialog: Cancel closes it and sends nothing, the confirming button
 * closes it and sends once, a destructive action's button is the danger one,
 * and closing returns the focus to what opened it, or to the menu's trigger
 * where a menu item that opened it has gone.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import { ConfirmDialog } from "../app/browser/ui/ConfirmDialog.tsx";
import { turned } from "./screenHarness.tsx";
import { styleless } from "./styleless.ts";
import { renderCopied } from "./copied.tsx";

afterEach(cleanup);

function Asked(props: {
  readonly danger?: boolean;
  readonly onConfirm: () => void;
}): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      title="Revoke ticket 7?"
      confirm="Revoke"
      danger={props.danger ?? false}
      open={open}
      onOpenChange={setOpen}
      onConfirm={props.onConfirm}
    >
      It stops the run.
    </ConfirmDialog>
  );
}

test("Cancel closes the confirm dialog and sends nothing", async () => {
  const sent: string[] = [];
  renderCopied(<Asked onConfirm={() => sent.push("sent")} />);
  await turned();
  const dialog = screen.getByRole("dialog", { name: "Revoke ticket 7?" });
  expect(dialog.textContent).toContain("It stops the run.");
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sent).toStrictEqual([]);
  styleless();
});

test("the confirming button closes the confirm dialog and sends once", async () => {
  const sent: string[] = [];
  renderCopied(<Asked onConfirm={() => sent.push("sent")} />);
  await turned();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sent).toStrictEqual(["sent"]);
  styleless();
});

test("a destructive action's confirming button is the danger button, and an irreversible one's the primary", async () => {
  renderCopied(<Asked danger onConfirm={() => undefined} />);
  await turned();
  expect(screen.getByRole("button", { name: "Revoke" }).classList).toContain(
    "btn-danger",
  );
  cleanup();
  renderCopied(<Asked onConfirm={() => undefined} />);
  await turned();
  expect(screen.getByRole("button", { name: "Revoke" }).classList).toContain(
    "btn-primary",
  );
});

function Opened(props: { readonly menu: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      {props.menu ? (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger>More</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                onSelect={() => {
                  setOpen(true);
                }}
              >
                Revoke…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Revoke…
        </button>
      )}
      <ConfirmDialog
        title="Revoke ticket 7?"
        confirm="Revoke"
        danger
        open={open}
        onOpenChange={setOpen}
        onConfirm={() => undefined}
      >
        It stops the run.
      </ConfirmDialog>
    </>
  );
}

async function openedFromButton(): Promise<HTMLElement> {
  renderCopied(<Opened menu={false} />);
  const opener = screen.getByRole("button", { name: "Revoke…" });
  opener.focus();
  await turned(() => {
    fireEvent.click(opener);
  });
  await turned();
  expect(document.activeElement).not.toBe(opener);
  return opener;
}

test("Cancel returns the focus to the button that opened the confirm dialog", async () => {
  const opener = await openedFromButton();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  styleless();
});

test("Escape returns the focus to the button that opened the confirm dialog", async () => {
  const opener = await openedFromButton();
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  styleless();
});

test("the confirming button returns the focus to the button that opened the confirm dialog", async () => {
  const opener = await openedFromButton();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  styleless();
});

test("a confirm dialog opened from a menu item returns the focus to the menu's trigger once the item has gone", async () => {
  renderCopied(<Opened menu />);
  const trigger = screen.getByRole("button", { name: "More" });
  trigger.focus();
  await turned(() => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke…" }));
  });
  await turned();
  const dialog = screen.getByRole("dialog", { name: "Revoke ticket 7?" });
  expect(screen.queryByRole("menuitem")).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await turned(() => {
    fireEvent.keyDown(dialog, { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  styleless();
});
