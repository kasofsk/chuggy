/**
 * What a page drawn on `CenteredPage` outside the shell says: its one
 * level-one title, which is also the document's, inside its one `main`, and
 * the actions under it, primary first.
 */

import { screen } from "@testing-library/react";
import { expect } from "vitest";

export interface CenteredPageSaid {
  readonly title: string;
  readonly actions: readonly string[];
}

export function centeredPageSaid(): CenteredPageSaid {
  const main = screen.getByRole("main");
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  const [heading] = headings;
  expect(main.contains(heading ?? null)).toBe(true);
  const title = heading?.textContent ?? "";
  expect(document.title).toBe(title);
  const actions = [...main.querySelectorAll(".centered-page-actions > *")].map(
    (action) => action.textContent,
  );
  return { title, actions };
}
