/**
 * A dispatch from the ticket page as a reader makes one: the state chip is
 * pressed, and the dialog it opens is answered with its own Dispatch.
 */

import { screen, within } from "@testing-library/react";

import { turned } from "./screenHarness.tsx";

/** The accessible name of the chip a ticket's dispatch is asked through. */
export function dispatchChipName(ticket: number): string {
  return `Dispatch ticket #${String(ticket)}`;
}

/** The chip pressed and the dialog it opened confirmed. */
export async function dispatchConfirmed(ticket: number): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name: dispatchChipName(ticket) }).click();
  });
  const asked = screen.getByRole("dialog", {
    name: `${dispatchChipName(ticket)}?`,
  });
  await turned(() => {
    within(asked).getByRole("button", { name: "Dispatch" }).click();
  });
}
