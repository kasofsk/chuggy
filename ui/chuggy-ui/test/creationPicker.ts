/**
 * The configuration picker of a drawn creation form, and choosing one of its
 * names as a person does, shared by the suites that drive the choice.
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

export function configurationPicker(): HTMLElement {
  return screen.getByRole("button", { name: /^Configuration/u });
}

export async function chooseConfiguration(name: string): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  fireEvent.keyDown(configurationPicker(), { key: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitemradio", { name }));
  await waitFor(() => {
    expect(configurationPicker().textContent).toContain(name);
  });
}
