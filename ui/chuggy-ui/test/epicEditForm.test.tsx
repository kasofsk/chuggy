/**
 * The epic's edit form on its fields: each field's label is drawn and bound
 * to its box, its hint and its fault are bound to it and drawn beside it, a
 * failed save moves focus to the first field it is about, a refusal about no
 * field is drawn above the actions, the actions are Save then a quiet Cancel,
 * and leaving with what was typed unsaved asks once.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { epicSummaryCharsMax } from "../../../src/contract/epics.ts";
import { EpicEditPage } from "../app/browser/epic/EpicEditPage.tsx";
import { epicPageDrawn, epicServingReset } from "./epicPageFixture.tsx";
import { epicNavigated, epicRouted } from "./epicPageRouter.tsx";
import { abilitiesEvery } from "./projectAbilitiesFixture.ts";
import { answer, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
  epicRouted.epic = "7";
  epicNavigated.length = 0;
});

async function editDrawn(
  written: (request: SentRequest) => Response = () => answer({}, 503),
): Promise<readonly SentRequest[]> {
  return (
    await epicPageDrawn(abilitiesEvery, { written, tab: <EpicEditPage /> })
  ).sent;
}

function writes(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((request) => request.method !== "GET");
}

function box(name: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByRole<HTMLInputElement | HTMLTextAreaElement>("textbox", {
    name,
  });
}

/** The words of everything a box is described by, in order. */
function describing(element: HTMLElement): readonly string[] {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

async function savePressed(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settled();
}

function confirming(answered: boolean) {
  const asked = vi.fn(() => answered);
  vi.stubGlobal("confirm", asked);
  return asked;
}

test("each field's label is drawn and bound to its box, and the summary's count and the description's format are bound to theirs", async () => {
  await editDrawn();
  for (const name of ["Title", "Summary", "Description"]) {
    const control = box(name);
    const label = document.querySelector(`label[for="${control.id}"]`);
    expect(label?.textContent).toMatch(new RegExp(`^${name}`, "u"));
    expect(label?.getAttribute("aria-hidden")).toBeNull();
  }
  expect(box("Title").getAttribute("aria-required")).toBe("true");
  expect(describing(box("Title"))).toStrictEqual([]);
  expect(describing(box("Summary"))).toStrictEqual(["14 / 600"]);
  expect(describing(box("Description"))).toStrictEqual(["Markdown"]);
  for (const name of ["Title", "Summary", "Description"])
    expect(box(name).getAttribute("aria-invalid")).toBe("false");
});

test("a fault is bound to the field it is about and drawn beside it, and a save it fails sends nothing and moves focus to the first such field", async () => {
  const sent = await editDrawn(() => answer({ epic: 7, revision: 4 }));
  fireEvent.change(box("Summary"), {
    target: { value: "s".repeat(epicSummaryCharsMax + 1) },
  });
  fireEvent.change(box("Title"), { target: { value: " " } });
  expect(box("Title").getAttribute("aria-invalid")).toBe("true");
  expect(describing(box("Title"))).toStrictEqual(["The title is empty."]);
  expect(box("Summary").getAttribute("aria-invalid")).toBe("true");
  expect(describing(box("Summary"))).toStrictEqual([
    `${String(epicSummaryCharsMax + 1)} / 600`,
    "The summary is too long.",
  ]);
  const titleField = box("Title").closest(".form-field");
  expect(titleField?.textContent).toContain("The title is empty.");
  expect(screen.queryByRole("list", { name: "Faults" })).toBeNull();

  box("Description").focus();
  await savePressed();
  expect(writes(sent)).toHaveLength(0);
  expect(document.activeElement).toBe(box("Title"));

  fireEvent.change(box("Title"), { target: { value: "Payments" } });
  box("Description").focus();
  await savePressed();
  expect(document.activeElement).toBe(box("Summary"));
});

test("a refusal about one field is drawn beside it and takes focus, and none is drawn above the actions", async () => {
  await editDrawn(() =>
    answer(
      { error: { code: "LongSummary", message: "The summary is longer." } },
      409,
    ),
  );
  box("Description").focus();
  await savePressed();
  expect(describing(box("Summary"))).toStrictEqual([
    "14 / 600",
    "The summary is too long.",
  ]);
  expect(box("Summary").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(box("Summary"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(epicNavigated).toStrictEqual([]);
});

test("a refusal about no one field is drawn above the actions, and marks no field", async () => {
  await editDrawn(() =>
    answer({ error: { code: "LargeContent", message: "large" } }, 409),
  );
  await savePressed();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("The epic is too large.");
  const save = screen.getByRole("button", { name: "Save" });
  expect(
    alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  for (const name of ["Title", "Summary", "Description"])
    expect(box(name).getAttribute("aria-invalid")).toBe("false");
});

test("the actions are Save, primary, then Cancel, quiet, and nothing else", async () => {
  await editDrawn();
  const actions = screen.getByRole("button", { name: "Save" }).parentElement;
  const pressed = [...(actions?.querySelectorAll("button") ?? [])];
  expect(pressed.map((button) => button.textContent)).toStrictEqual([
    "Save",
    "Cancel",
  ]);
  expect(pressed[0]?.className).toContain("btn-primary");
  expect(pressed[0]?.getAttribute("type")).toBe("submit");
  expect(pressed[1]?.className).toContain("btn-quiet");
});

test("Cancel with what was typed unsaved asks once, and staying stays with it", async () => {
  const asked = confirming(false);
  await editDrawn();
  fireEvent.change(box("Title"), { target: { value: "Payments" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settled();
  expect(asked).toHaveBeenCalledOnce();
  expect(asked).toHaveBeenCalledWith(
    "Discard the unsaved changes to the epic and leave?",
  );
  expect(epicNavigated).toStrictEqual([]);
  expect(box("Title").value).toBe("Payments");
});

test("Cancel the reader agrees to leaves, and a form typed back to the epic as read leaves without asking", async () => {
  const asked = confirming(true);
  await editDrawn();
  fireEvent.change(box("Title"), { target: { value: "Payments" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settled();
  expect(asked).toHaveBeenCalledOnce();
  expect(epicNavigated).toHaveLength(1);

  cleanup();
  epicNavigated.length = 0;
  asked.mockClear();
  await editDrawn();
  fireEvent.change(box("Title"), { target: { value: "Payments" } });
  fireEvent.change(box("Title"), { target: { value: "Billing" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settled();
  expect(asked).not.toHaveBeenCalled();
  expect(epicNavigated).toHaveLength(1);
});

test("a save the API takes leaves without asking", async () => {
  const asked = confirming(false);
  await editDrawn(() => answer({ epic: 7, revision: 4 }));
  fireEvent.change(box("Title"), { target: { value: "Payments" } });
  await savePressed();
  expect(asked).not.toHaveBeenCalled();
  expect(epicNavigated).toHaveLength(1);
});
