/**
 * Whether the reader sees projects' banners, kept in this browser. `Shown` is
 * the absence of the key, so a reader who never chose sees them.
 */

import type { KeyValuePort } from "../core/sessionHolder.ts";

export const projectBannersChoices = ["Shown", "Hidden"] as const;

export type ProjectBannersChoice = (typeof projectBannersChoices)[number];

export const projectBannersStoreKey = "chug.project-banners";

export function projectBannersRead(store: KeyValuePort): ProjectBannersChoice {
  return store.read(projectBannersStoreKey) === "Hidden" ? "Hidden" : "Shown";
}

export function projectBannersWrite(
  store: KeyValuePort,
  choice: ProjectBannersChoice,
): void {
  if (choice === "Shown") store.remove(projectBannersStoreKey);
  else store.write(projectBannersStoreKey, choice);
}
