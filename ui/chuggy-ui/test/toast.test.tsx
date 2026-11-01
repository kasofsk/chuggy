/**
 * A toast is a refusal its reader already missed once, so it stays until its
 * Dismiss and is not closed by Radix's timer.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Toasts } from "../app/browser/ui/Toast.tsx";

/** What `Toast.Provider` closes a toast after where it is given no duration. */
const radixToastDurationMsDefault = 5000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a toast is still open after Radix's default duration, and closes on its Dismiss", () => {
  vi.useFakeTimers();
  const dismissed = vi.fn();
  render(
    <Toasts
      toasts={[{ id: 1, line: "Cancel refused · terminal" }]}
      onDismiss={dismissed}
    />,
  );

  act(() => {
    vi.advanceTimersByTime(radixToastDurationMsDefault * 2);
  });

  expect(screen.getByText("Cancel refused · terminal")).toBeDefined();
  expect(dismissed).not.toHaveBeenCalled();

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  });

  expect(dismissed).toHaveBeenCalledWith(1);
});
