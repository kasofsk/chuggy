/**
 * The theme the operator chose, where it is kept, and the attribute that
 * carries it.
 *
 * `System` is the absence of the attribute, so a console that has never been
 * told follows the machine it is drawn on and a stored choice survives a
 * reload. The choice is an attribute on the document element because the
 * served policy admits no inline style, and every colour is defined once for
 * both themes behind `color-scheme`.
 */

import type { KeyValuePort } from "../core/sessionHolder.ts";

export const themeChoices = ["System", "Light", "Dark"] as const;

export type ThemeChoice = (typeof themeChoices)[number];

export const themeStoreKey = "chuggy-theme";

export function themeChoiceRead(store: KeyValuePort): ThemeChoice {
  const held = store.read(themeStoreKey);
  return themeChoices.find((candidate) => candidate === held) ?? "System";
}

export function themeChoiceWrite(
  store: KeyValuePort,
  choice: ThemeChoice,
): void {
  if (choice === "System") store.remove(themeStoreKey);
  else store.write(themeStoreKey, choice);
}

export function themeChoiceApply(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "System") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice.toLowerCase());
}
