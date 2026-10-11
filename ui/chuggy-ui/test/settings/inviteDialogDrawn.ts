/**
 * A dialog that invites as a case reads it, the same for a workspace's and
 * the site's: which of a person and a link it is on, the fields and the
 * actions it draws, the choice pressed, and a press outside it.
 */

import { fireEvent, within } from "@testing-library/react";

import { turned } from "../screenHarness.tsx";

/** The two words of the choice, `+` on the one chosen, and none where no choice is drawn. */
export function inviteModesDrawn(dialog: HTMLElement): readonly string[] {
  return within(dialog)
    .queryAllByRole("radio")
    .filter((radio) => radio.closest('[aria-label="Invite by"]') !== null)
    .map(
      (radio) =>
        `${radio.textContent}${radio.getAttribute("aria-checked") === "true" ? "+" : ""}`,
    );
}

export function dialogFields(dialog: HTMLElement): readonly (string | null)[] {
  return within(dialog)
    .queryAllByRole("textbox")
    .map((box) => box.getAttribute("aria-label"));
}

export function dialogActions(dialog: HTMLElement): readonly (string | null)[] {
  return within(dialog)
    .getAllByRole("button")
    .map((button) => button.textContent);
}

export async function inviteModeChosen(
  dialog: HTMLElement,
  mode: string,
): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog).getByRole("radio", { name: mode }));
  });
}

/** A press outside a dialog, which Radix counts at the click the press ends in. */
export function pressedOutside(): void {
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
}

/** What a made link's token must be absent from once its dialog is put away: the page, the browser's stores, and every request the page sent. */
export function tokenHeldOutside(
  token: string,
  sent: readonly unknown[],
): readonly string[] {
  return [
    ...(document.body.textContent.includes(token) ? ["page"] : []),
    ...(JSON.stringify([{ ...localStorage }, { ...sessionStorage }]).includes(
      token,
    )
      ? ["storage"]
      : []),
    ...(document.cookie.includes(token) ? ["cookie"] : []),
    ...(sent.some((request) => JSON.stringify(request).includes(token))
      ? ["request"]
      : []),
  ];
}
