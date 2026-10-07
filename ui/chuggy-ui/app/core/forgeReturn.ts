/**
 * The one word a person brings back from the forge to the page they started
 * on, where the return did not simply connect. It is held in tab storage for
 * one tenant and taken once, by the page it returns to.
 */

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

export interface ForgeReturnWord {
  readonly standing: ForgeReturnStanding;
  readonly status: string;
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
    const status = fields["status"];
    if (standing === undefined || typeof status !== "string") return undefined;
    return { standing, status };
  } catch {
    return undefined;
  }
}
