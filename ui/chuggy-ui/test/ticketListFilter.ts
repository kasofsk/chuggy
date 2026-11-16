/**
 * The tickets list's one Filter control as a reader drives it: opened, a
 * labelled field in its panel set to an option by the words it says, and the
 * marks under the bar read and pressed. Each suite settles its own screen its
 * own way, so it hands that in.
 */

import { fireEvent, screen, within } from "@testing-library/react";

/** The Filter control in the bar, named for the filter and how many are set. */
export function ticketListFilterControl(): HTMLElement {
  return screen.getByRole("button", { name: /^Filter/u });
}

/** The open panel, opened first where it is not. */
export async function ticketListFilterOpened(
  settle: () => Promise<void>,
): Promise<HTMLElement> {
  const open = screen.queryByRole("dialog", { name: "Filter" });
  if (open !== null) return open;
  fireEvent.click(ticketListFilterControl());
  await settle();
  return screen.getByRole("dialog", { name: "Filter" });
}

/** What a field of the panel holds, by the words its option says. */
export async function ticketListFilterHeld(
  field: string,
  settle: () => Promise<void>,
): Promise<string | undefined> {
  const panel = await ticketListFilterOpened(settle);
  const select = within(panel).getByRole<HTMLSelectElement>("combobox", {
    name: field,
  });
  const held = select.selectedOptions[0]?.textContent ?? undefined;
  await ticketListFilterClosed(settle);
  return held;
}

/** The panel closed as a keyboard closes it, which hands the page back to
 * assistive technology. */
export async function ticketListFilterClosed(
  settle: () => Promise<void>,
): Promise<void> {
  if (screen.queryByRole("dialog", { name: "Filter" }) === null) return;
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  await settle();
}

/** A field of the panel set to the option that says `option`, and the panel
 * closed again. */
export async function ticketListFilterChosen(
  field: string,
  option: string,
  settle: () => Promise<void>,
): Promise<void> {
  const panel = await ticketListFilterOpened(settle);
  const select = within(panel).getByRole<HTMLSelectElement>("combobox", {
    name: field,
  });
  const chosen = within(select).getByRole<HTMLOptionElement>("option", {
    name: option,
  });
  fireEvent.change(select, { target: { value: chosen.value } });
  await settle();
  await ticketListFilterClosed(settle);
}

/** What each mark under the bar says, in order; none where none is drawn. */
export function ticketListFilterMarks(): readonly string[] {
  const marks = screen.queryByRole("list", { name: "Filters set" });
  if (marks === null) return [];
  return within(marks)
    .getAllByRole("button")
    .map((mark) => mark.getAttribute("aria-label") ?? "");
}
