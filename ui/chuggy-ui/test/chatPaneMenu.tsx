/**
 * The open chat pane's menu as a case reaches into it: everything its header
 * does not draw as a control of its own is an item here, by its word.
 */

import { act, fireEvent, screen, within } from "@testing-library/react";

import { settled } from "./screenHarness.tsx";

/** The pane's menu, opened from its trigger. */
export async function chatPaneMenuOpened(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat menu" }), {
    key: "ArrowDown",
  });
  return screen.findByRole("menu");
}

/** The words of what the pane's menu offers, in its order, closed again. */
export async function chatPaneMenuOffers(): Promise<readonly string[]> {
  const menu = await chatPaneMenuOpened();
  const offered = within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  fireEvent.keyDown(menu, { key: "Escape" });
  await settled();
  return offered;
}

/** One of the pane's menu items, chosen by its word. */
export async function chatPaneMenuChosen(name: string): Promise<void> {
  const menu = await chatPaneMenuOpened();
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name }));
    await Promise.resolve();
  });
  await settled();
}

/** The history the pane's menu opens, as its dialog. */
export async function chatPaneHistoryOpened(): Promise<HTMLElement> {
  await chatPaneMenuChosen("History");
  return screen.findByRole("dialog", { name: "History" });
}

/** The thread of the pane's history whose row is named so, chosen. */
export async function chatPaneHistoryChosen(name: RegExp): Promise<void> {
  const history = await chatPaneHistoryOpened();
  await act(async () => {
    fireEvent.click(within(history).getByRole("button", { name }));
    await Promise.resolve();
  });
  await settled();
}
