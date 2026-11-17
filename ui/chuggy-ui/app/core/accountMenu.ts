/**
 * What the account menu draws of the signed-in reader: their GitHub login,
 * which is the name they go by, and their email, each only where the access
 * plane's account of them answers it, and the initials its trigger shows —
 * the login's, or else the email's. A read that has not answered, or failed,
 * is drawn as one that answered neither.
 */

import type { AccessCallerAccount } from "../../../../src/contract/accessPlane.ts";

export interface AccountMenuShown {
  readonly login: string | undefined;
  readonly email: string | undefined;
  /** Absent where neither is answered, so the trigger is a plain mark. */
  readonly initials: string | undefined;
}

/** How many words of a name its initials are taken from. */
const accountMenuInitialsWordsMax = 2;

/** The first letter of each of a name's first words, its words split where
 * a login or an email's local part breaks them, and none where it has no
 * word. */
function accountMenuInitials(name: string): string | undefined {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .slice(0, accountMenuInitialsWordsMax);
  if (words.length === 0) return undefined;
  return words
    .map((word) => String.fromCodePoint(word.codePointAt(0) ?? 0))
    .join("")
    .toUpperCase();
}

export function accountMenuShown(
  account: AccessCallerAccount | undefined,
): AccountMenuShown {
  const login = account?.githubLogin;
  const email = account?.email;
  const initials =
    (login === undefined ? undefined : accountMenuInitials(login)) ??
    (email === undefined
      ? undefined
      : accountMenuInitials(email.slice(0, email.lastIndexOf("@"))));
  return { login, email, initials };
}
