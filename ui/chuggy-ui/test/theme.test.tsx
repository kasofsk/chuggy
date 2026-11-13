/**
 * The theme: what is stored, what is put on the document, and the control on
 * the Preferences page that sets both.
 *
 * `System` is the absence of the attribute rather than a third value, so the
 * cases read the attribute itself; a stored word this console does not know is
 * read as `System` rather than trusted.
 */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import { PreferencesPage } from "../app/browser/settings/PreferencesPage.tsx";
import { answer, drawnStrict } from "./screenHarness.tsx";
import {
  siteAbilitiesNone,
  siteAbilitiesPath,
} from "./settings/permissionsFixture.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeStoreKey,
} from "../app/browser/theme.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ tenant: "acme" }),
}));

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
  localStorage.removeItem(themeStoreKey);
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

test("a choice is stored under its own key, and System stores nothing", () => {
  const held: Record<string, string> = {};
  const store = storeDouble(held);
  themeChoiceWrite(store, "Dark");
  expect(held[themeStoreKey]).toBe("Dark");
  expect(themeChoiceRead(store)).toBe("Dark");
  themeChoiceWrite(store, "System");
  expect(themeStoreKey in held).toBe(false);
  expect(themeChoiceRead(store)).toBe("System");
});

test("a word this console does not know is read as System", () => {
  expect(themeChoiceRead(storeDouble({ [themeStoreKey]: "Sepia" }))).toBe(
    "System",
  );
});

test("the attribute carries the choice, and System takes it off", () => {
  const root = document.documentElement;
  themeChoiceApply(root, "Light");
  expect(root.getAttribute("data-theme")).toBe("light");
  themeChoiceApply(root, "Dark");
  expect(root.getAttribute("data-theme")).toBe("dark");
  themeChoiceApply(root, "System");
  expect(root.hasAttribute("data-theme")).toBe(false);
});

/** The choice is on the Preferences page, and a second reading mounts the
 * page again, which is also what a reload does. */
async function preferencesDrawn(): Promise<void> {
  cleanup();
  viewportAtEm(viewportDeskEm);
  await drawnStrict(<PreferencesPage />, (request) =>
    request.url === siteAbilitiesPath
      ? answer(siteAbilitiesNone)
      : answer({}, 404),
  );
  await screen.findByRole("radiogroup", { name: "Light or dark" });
}

function themeChecked(name: string): string | null {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked");
}

test("the page's Appearance holds the choice, which checks one at a time and writes what it applied", async () => {
  await preferencesDrawn();
  expect(
    screen.getByRole("heading", { level: 2, name: "Appearance" }),
  ).toBeDefined();
  expect(themeChecked("System")).toBe("true");
  expect(themeChecked("Dark")).toBe("false");
  act(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  });
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(localStorage.getItem(themeStoreKey)).toBe("Dark");
  expect(themeChecked("Dark")).toBe("true");

  await preferencesDrawn();
  expect(themeChecked("Dark")).toBe("true");
  expect(themeChecked("System")).toBe("false");
  act(() => {
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
  });
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem(themeStoreKey)).toBeNull();
});
