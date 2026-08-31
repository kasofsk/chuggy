/**
 * The theme: what is stored, what is put on the document, and the control in
 * the shell that sets both.
 *
 * `System` is the absence of the attribute rather than a third value, so the
 * cases read the attribute itself; a stored word this console does not know is
 * read as `System` rather than trusted.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import { ThemeControl } from "../app/browser/Shell.tsx";
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
  Outlet: () => null,
  useNavigate: () => () => undefined,
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

test("the control presses one toggle at a time and writes what it applied", () => {
  render(<ThemeControl />);
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(localStorage.getItem(themeStoreKey)).toBe("Dark");
  expect(
    screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "System" }));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem(themeStoreKey)).toBeNull();
});
