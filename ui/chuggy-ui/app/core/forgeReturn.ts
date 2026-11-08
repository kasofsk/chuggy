/**
 * The one word a person brings back from the forge to the page they started
 * on, where the return did not simply connect. It is held in tab storage for
 * one tenant and taken once, by the page it returns to.
 */

import type { Copy } from "./copy.ts";
import type { KeyValuePort } from "./sessionHolder.ts";

/** Where the word is held, which is `sessionStorage` and not the URL. */
export const forgeReturnKey = "chuggy.forgeReturn";

/** `Uninstalled` reached no account the person owns, which only the portal app's install puts right. */
export const forgeReturnStandings = [
  "Failed",
  "Unfinished",
  "Uninstalled",
] as const;

export type ForgeReturnStanding = (typeof forgeReturnStandings)[number];

/** What came of the return, held as a code so the words are the catalog's
 * wherever the page that takes it draws them. */
export const forgeReturnStatuses = [
  "Declined",
  "Partial",
  "NotInstalled",
  "Unavailable",
  "Requested",
  "NotConfigured",
  "Refused",
  "NotFound",
  "Conflict",
  "SignedOut",
  "Spent",
  "Failed",
  "Unreachable",
  "Unreadable",
] as const;

export type ForgeReturnStatus = (typeof forgeReturnStatuses)[number];

export interface ForgeReturnWord {
  readonly standing: ForgeReturnStanding;
  readonly status: ForgeReturnStatus;
}

/** A return's status in the words the page draws it in. */
export function forgeReturnStatusLabel(status: ForgeReturnStatus): Copy {
  switch (status) {
    case "Declined":
      return { id: "repositories-return-declined" };
    case "Partial":
      return { id: "repositories-return-partial" };
    case "NotInstalled":
      return { id: "repositories-not-installed" };
    case "Unavailable":
      return { id: "repositories-unavailable" };
    case "Requested":
      return { id: "repositories-return-requested" };
    case "NotConfigured":
      return { id: "repositories-not-configured" };
    case "Refused":
      return { id: "repositories-refused" };
    case "NotFound":
      return { id: "repositories-not-found" };
    case "Conflict":
      return { id: "repositories-conflict" };
    case "SignedOut":
      return { id: "repositories-signed-out" };
    case "Spent":
      return { id: "repositories-return-spent" };
    case "Failed":
      return { id: "repositories-failed" };
    case "Unreachable":
      return { id: "repositories-unreachable" };
    case "Unreadable":
      return { id: "repositories-unreadable" };
  }
}

export function forgeReturnHold(
  store: KeyValuePort,
  tenant: string,
  word: ForgeReturnWord,
): void {
  store.write(
    forgeReturnKey,
    JSON.stringify({
      tenant,
      standing: word.standing,
      status: word.status,
    }),
  );
}

/** Read once and removed, and a word held for another tenant is dropped unread. */
export function forgeReturnTake(
  store: KeyValuePort,
  tenant: string,
): ForgeReturnWord | undefined {
  const stored = store.read(forgeReturnKey);
  store.remove(forgeReturnKey);
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const fields = parsed as Record<string, unknown>;
    if (fields["tenant"] !== tenant) return undefined;
    const standing = forgeReturnStandings.find(
      (known) => known === fields["standing"],
    );
    const status = forgeReturnStatuses.find(
      (known) => known === fields["status"],
    );
    if (standing === undefined || status === undefined) return undefined;
    return { standing, status };
  } catch {
    return undefined;
  }
}
