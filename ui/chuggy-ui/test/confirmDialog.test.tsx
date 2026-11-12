/**
 * The confirm dialog: Cancel closes it and sends nothing, the confirming button
 * closes it and sends once, and a destructive action's button is the danger
 * one.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
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
