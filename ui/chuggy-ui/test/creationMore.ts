/**
 * The ticket form's one disclosure, opened as a person opens it, for the
 * suites that drive a field kept under it.
 */

import { fireEvent, screen, waitFor } from "@testing-library/react";

export function creationMoreTrigger(): HTMLElement {
  return screen.getByRole("button", { name: /^More options/u });
}

/** Opens the disclosure where it is closed, and leaves an open one open. */
export function creationMoreOpened(): void {
  const trigger = creationMoreTrigger();
  if (trigger.getAttribute("aria-expanded") === "false")
    fireEvent.click(trigger);
}

/** What `find` finds once the disclosure is open. */
export function disclosed<Found>(find: () => Found): Found {
  creationMoreOpened();
  return find();
}

/** The same, for a form still being drawn: the disclosure is opened once its
 * trigger is there. */
export async function disclosedFound<Found>(
  find: () => Promise<Found>,
): Promise<Found> {
  await waitFor(creationMoreOpened);
  return find();
}
