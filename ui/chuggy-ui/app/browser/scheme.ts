/**
 * The light, dark or system scheme the reader chose, where it is kept, and the
 * attribute that carries it.
 *
 * `System` is the absence of the attribute, so a console that has never been
 * told follows the machine it is drawn on and a stored choice survives a
 * reload. The choice is an attribute on the document element because the
 * served policy admits no inline style, and every colour is defined once for
 * both schemes behind `color-scheme`. It was kept under `chuggy-theme` before
 * a theme was a document of its own, and is moved from there on its first
 * read.
 */

import type { KeyValuePort } from "../core/sessionHolder.ts";

export const schemeChoices = ["System", "Light", "Dark"] as const;

export type SchemeChoice = (typeof schemeChoices)[number];

export const schemeStoreKey = "chuggy-scheme";

export const schemeStoreKeyRetired = "chuggy-theme";

function schemeChoiceOf(held: string | null): SchemeChoice {
  return schemeChoices.find((candidate) => candidate === held) ?? "System";
}

/** The stored choice, moved out of the retired key where only it holds one. */
export function schemeChoiceRead(store: KeyValuePort): SchemeChoice {
  const held = store.read(schemeStoreKey);
  if (held !== null) return schemeChoiceOf(held);
  const retired = store.read(schemeStoreKeyRetired);
  if (retired === null) return "System";
  const choice = schemeChoiceOf(retired);
  schemeChoiceWrite(store, choice);
  store.remove(schemeStoreKeyRetired);
  return choice;
}

export function schemeChoiceWrite(
  store: KeyValuePort,
  choice: SchemeChoice,
): void {
  if (choice === "System") store.remove(schemeStoreKey);
  else store.write(schemeStoreKey, choice);
}

export function schemeChoiceApply(
  root: HTMLElement,
  choice: SchemeChoice,
): void {
  if (choice === "System") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice.toLowerCase());
}
