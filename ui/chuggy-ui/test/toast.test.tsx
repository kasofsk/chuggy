/**
 * A toast in each of its tones. A failure is a refusal its reader already
 * missed once: announced assertively, it stays until its Dismiss and is not
 * closed by any timer. A success is announced politely and closes itself
 * after the token's time, which is held while the pointer is over the toasts
 * or focus is in them. Each tone says its word beside its line, and on a phone
 * the toasts keep to the head of the screen, clear of its unsafe edge, where
 * the chat's strip and its composer at the foot are not under them.
 */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import toastSheet from "../app/browser/ui/Toast.css?raw";
import {
  Toasts,
  toastReadMsOf,
  toastReadToken,
} from "../app/browser/ui/Toast.tsx";
import type { ToastLine } from "../app/browser/ui/Toast.tsx";
import tokenSheet from "../app/styles/tokens.css?raw";
import { renderCopied } from "./copied.tsx";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";

/** The time `tokens.css` gives a success, set on the page as the sheet would. */
const toastReadDeclared = sheetDeclared(
  sheetRules(tokenSheet, []),
  document.documentElement,
  toastReadToken,
);
const toastReadMs = toastReadMsOf(toastReadDeclared);

beforeEach(() => {
  document.documentElement.style.setProperty(toastReadToken, toastReadDeclared);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.style.removeProperty(toastReadToken);
});

const failure: ToastLine = {
  id: 1,
  tone: "Failure",
  line: "Cancel refused · terminal",
};
const success: ToastLine = { id: 2, tone: "Success", line: "Epic 7 archived" };

function drawn(toasts: readonly ToastLine[]) {
  const dismissed = vi.fn();
  renderCopied(<Toasts toasts={toasts} onDismiss={dismissed} />);
  return dismissed;
}

function elapsed(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function viewport(): HTMLElement {
  const held = document.querySelector<HTMLElement>(".toast-viewport");
  if (held === null) throw new Error("no toast viewport was drawn");
  return held;
}

/** The landmark Radix pauses and resumes the toasts' time from. */
function region(): HTMLElement {
  const held = viewport().closest<HTMLElement>('[role="region"]');
  if (held === null) throw new Error("the viewport is in no region");
  return held;
}

/** How the one toast drawn is announced. */
function announced(): readonly (string | null)[] {
  return [...document.querySelectorAll('[role="status"][aria-live]')].map(
    (status) => status.getAttribute("aria-live"),
  );
}

test("the token gives a success a time, read in milliseconds", () => {
  expect(toastReadMs).toBeGreaterThan(0);
  expect(Number.isFinite(toastReadMs)).toBe(true);
  expect(toastReadMsOf("1.5s")).toBe(1500);
  expect(toastReadMsOf("")).toBe(Number.POSITIVE_INFINITY);
});

test("a failure is announced assertively, says its word, and stays past a success's time until its Dismiss", () => {
  vi.useFakeTimers();
  const dismissed = drawn([failure]);
  elapsed(0);

  expect(announced()).toStrictEqual(["assertive"]);
  expect(screen.getByText("Refused")).toBeDefined();

  elapsed(toastReadMs * 2);

  expect(screen.getByText(failure.line)).toBeDefined();
  expect(dismissed).not.toHaveBeenCalled();

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  });

  expect(dismissed).toHaveBeenCalledWith(1);
});

test("a success is announced politely, says its word, and closes itself once its time is up", () => {
  vi.useFakeTimers();
  const dismissed = drawn([success]);
  elapsed(0);

  expect(announced()).toStrictEqual(["polite"]);
  expect(screen.getByText("Done")).toBeDefined();

  elapsed(toastReadMs - 1);
  expect(dismissed).not.toHaveBeenCalled();

  elapsed(1);
  expect(dismissed).toHaveBeenCalledWith(2);
});

test("a success's time is held while the pointer is over the toasts, and runs again once it leaves", () => {
  vi.useFakeTimers();
  const dismissed = drawn([success]);
  elapsed(0);

  fireEvent.pointerMove(viewport());
  elapsed(toastReadMs * 2);
  expect(dismissed).not.toHaveBeenCalled();

  fireEvent.pointerLeave(region());
  elapsed(toastReadMs);
  expect(dismissed).toHaveBeenCalledWith(2);
});

test("a success's time is held while focus is in the toasts, and runs again once it leaves them", () => {
  vi.useFakeTimers();
  const dismissed = drawn([success]);
  elapsed(0);

  const close = screen.getByRole("button", { name: "Dismiss" });
  act(() => {
    close.focus();
  });
  elapsed(toastReadMs * 2);
  expect(dismissed).not.toHaveBeenCalled();

  act(() => {
    close.blur();
  });
  elapsed(toastReadMs);
  expect(dismissed).toHaveBeenCalledWith(2);
});

test("a failure beside a success stays once the success has closed itself", () => {
  vi.useFakeTimers();
  const dismissed = drawn([failure, success]);
  elapsed(toastReadMs * 2);

  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(dismissed).toHaveBeenCalledWith(2);
});

test("on a phone the toasts keep to the head of the screen, clear of its unsafe edge", () => {
  drawn([failure]);
  const narrow = sheetRules(toastSheet, [sheetNarrowCondition]);
  const desk = sheetRules(toastSheet, []);

  expect(sheetDeclared(desk, viewport(), "inset-block-end")).toBe("0px");
  expect(sheetDeclared(narrow, viewport(), "inset-block-start")).toBe("0px");
  expect(sheetDeclared(narrow, viewport(), "inset-block-end")).toBe("auto");
  expect(sheetDeclared(narrow, viewport(), "padding-block-start")).toMatch(
    "env(safe-area-inset-top)",
  );
});
