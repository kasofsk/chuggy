/**
 * A dispatch from the ticket page as a reader makes one: the header's
 * Dispatch is pressed, and the dialog it opens is answered with its own.
 */

import { screen, within } from "@testing-library/react";

import { turned } from "./screenHarness.tsx";

/** The accessible name of the header's Dispatch. */
export const dispatchButtonName = "Dispatch";

/** The title of the dialog a ticket's Dispatch asks through. */
export function dispatchAskTitle(ticket: number): string {
  return `Dispatch ticket #${String(ticket)}?`;
}

/** Dispatch pressed and the dialog it opened confirmed. */
export async function dispatchConfirmed(ticket: number): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name: dispatchButtonName }).click();
  });
  const asked = screen.getByRole("dialog", { name: dispatchAskTitle(ticket) });
  await turned(() => {
    within(asked).getByRole("button", { name: "Dispatch" }).click();
  });
}
