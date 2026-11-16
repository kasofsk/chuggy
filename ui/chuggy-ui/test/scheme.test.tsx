/**
 * The light, dark or system scheme: what is stored, what is put on the
 * document, and the control on the preferences page that sets both.
 *
 * `System` is the absence of the attribute rather than a third value, so the
 * cases read the attribute itself; a stored word this console does not know is
 * read as `System` rather than trusted.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type * as RouterModule from "@tanstack/react-router";

import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import { PreferencesPage } from "../app/browser/settings/PreferencesPage.tsx";
import { answer, drawnStrict } from "./screenHarness.tsx";
import { atlas } from "./shellRouter.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  schemeChoiceApply,
  schemeChoiceRead,
  schemeChoiceWrite,
  schemeStoreKey,
  schemeStoreKeyRetired,
} from "../app/browser/scheme.ts";

vi.mock("@tanstack/react-router", async (importOriginal) =>
  (await import("./shellRouter.tsx")).routerDouble(
    await importOriginal<typeof RouterModule>(),
    { outlet: () => null, params: () => atlas },
  ),
);

function storeDouble(held: Record<string, string>): KeyValuePort {
  return {
    read: (key) => held[key] ?? null,
    write: (key, value) => {
      held[key] = value;
    },
    remove: (key) => {
      delete held[key];
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(schemeStoreKey);
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

test("a choice is stored under its own key, and System stores nothing", () => {
  const held: Record<string, string> = {};
  const store = storeDouble(held);
  schemeChoiceWrite(store, "Dark");
  expect(held[schemeStoreKey]).toBe("Dark");
  expect(schemeChoiceRead(store)).toBe("Dark");
  schemeChoiceWrite(store, "System");
  expect(schemeStoreKey in held).toBe(false);
  expect(schemeChoiceRead(store)).toBe("System");
});

test("a word this console does not know is read as System", () => {
  expect(schemeChoiceRead(storeDouble({ [schemeStoreKey]: "Sepia" }))).toBe(
    "System",
  );
});

test("a choice kept under the retired key is moved to its own and read as it was", () => {
  const held: Record<string, string> = { [schemeStoreKeyRetired]: "Dark" };
  expect(schemeChoiceRead(storeDouble(held))).toBe("Dark");
  expect(held).toStrictEqual({ [schemeStoreKey]: "Dark" });
});

test("a choice under its own key wins over one left under the retired key", () => {
  const held: Record<string, string> = {
    [schemeStoreKey]: "Light",
    [schemeStoreKeyRetired]: "Dark",
  };
  expect(schemeChoiceRead(storeDouble(held))).toBe("Light");
});

test("System under the retired key is moved as System, which keeps nothing", () => {
  const held: Record<string, string> = { [schemeStoreKeyRetired]: "System" };
  expect(schemeChoiceRead(storeDouble(held))).toBe("System");
  expect(held).toStrictEqual({});
});

test("the attribute carries the choice, and System takes it off", () => {
  const root = document.documentElement;
  schemeChoiceApply(root, "Light");
  expect(root.getAttribute("data-theme")).toBe("light");
  schemeChoiceApply(root, "Dark");
  expect(root.getAttribute("data-theme")).toBe("dark");
  schemeChoiceApply(root, "System");
  expect(root.hasAttribute("data-theme")).toBe(false);
});

/** The preferences page drawn afresh, which is what a reload does. */
async function schemePageDrawn(): Promise<void> {
  cleanup();
  viewportAtEm(viewportDeskEm);
  await drawnStrict(<PreferencesPage />, () => answer({}, 404));
  await screen.findByRole("radio", { name: "Dark" });
}

function schemeChecked(name: string): string | null {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked");
}

test("the control checks one choice at a time, applies it, and writes what it applied", async () => {
  await schemePageDrawn();
  expect(
    screen.getByRole("radiogroup", { name: "Light or dark" }),
  ).toBeDefined();
  expect(schemeChecked("System")).toBe("true");
  expect(schemeChecked("Dark")).toBe("false");
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(localStorage.getItem(schemeStoreKey)).toBe("Dark");

  await schemePageDrawn();
  expect(schemeChecked("Dark")).toBe("true");
  expect(schemeChecked("System")).toBe("false");
  fireEvent.click(screen.getByRole("radio", { name: "System" }));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem(schemeStoreKey)).toBeNull();
});
