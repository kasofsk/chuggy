/**
 * Who the account menu says the reader is: their GitHub login, which is the
 * name they go by, their email, and the initials its trigger shows, from the
 * login or else the email. An answer naming neither, or no answer, names
 * nobody, and the menu draws a plain mark in its place.
 */

import type { AccessCallerAccount } from "../../../../src/contract/accessPlane.ts";

export interface AccountNamed {
  readonly login: string | undefined;
  readonly email: string | undefined;
  /** Absent where neither the login nor the email gives a letter. */
  readonly initials: string | undefined;
}

/** The words of a name, split wherever it is not a letter or a digit. */
const accountNameBreak = /[^\p{L}\p{N}]+/u;

/** The first letter of a name's first two words, or of its only word. */
export function accountInitials(name: string): string | undefined {
  const words = name.split(accountNameBreak).filter((word) => word !== "");
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return letters === "" ? undefined : letters.toUpperCase();
}

export function accountNamed(
  account: AccessCallerAccount | undefined,
): AccountNamed {
  const login = account?.githubLogin;
  const email = account?.email;
  const source = login ?? email?.split("@")[0];
  return {
    login,
    email,
    initials: source === undefined ? undefined : accountInitials(source),
  };
}
