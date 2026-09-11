/**
 * The setup landing's decisions: what the forge sent back, whether it belongs
 * to the transaction this tab started, and where the person goes next.
 *
 * The landing claims nothing it cannot match. A state that does not match the
 * stored transaction — or a landing reached with nothing stored, which is what
 * a replay looks like once the transaction has been taken — is refused, and no
 * installation identity is sent anywhere.
 */

import type { ForgeInstallTransaction } from "./forgeInstallation.ts";

/** What the forge says the person did, which `request` alone claims nothing for. */
export const forgeSetupActions = ["install", "update", "request"] as const;

export type ForgeSetupAction = (typeof forgeSetupActions)[number];

export interface ForgeSetupQuery {
  readonly installationId: string | undefined;
  readonly action: ForgeSetupAction | undefined;
  readonly state: string | undefined;
}

function forgeSetupActionOf(value: unknown): ForgeSetupAction | undefined {
  return forgeSetupActions.find((known) => known === value);
}

function forgeSetupText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** What the forge put on the address, read off the query the router parsed.
 * The names are the forge's own and are what it redirects with. */
export function forgeSetupQueryOf(
  search: Readonly<Record<string, unknown>>,
): ForgeSetupQuery {
  return {
    installationId: forgeSetupText(search["installation_id"]),
    action: forgeSetupActionOf(search["setup_action"]),
    state: forgeSetupText(search["state"]),
  };
}

export type ForgeSetupDecision =
  | {
      readonly decision: "Claim";
      readonly transaction: ForgeInstallTransaction;
      readonly installationId: string;
    }
  | {
      readonly decision: "Requested";
      readonly transaction: ForgeInstallTransaction;
    }
  | { readonly decision: "Unexpected" };

/** The landing's one line for a return it cannot place. */
export const forgeSetupUnexpected = "Not expected";

/** The landing's one line for an install an organization's owner has to approve. */
export const forgeSetupRequested = "Requested";

/**
 * What the landing does with what it was handed. The state is compared against
 * the transaction this tab stored, so a return carrying somebody else's state —
 * or none — claims nothing.
 */
export function forgeSetupDecision(
  query: ForgeSetupQuery,
  taken: ForgeInstallTransaction | undefined,
): ForgeSetupDecision {
  if (taken === undefined) return { decision: "Unexpected" };
  if (query.state === undefined || query.state !== taken.state)
    return { decision: "Unexpected" };
  if (query.action === "request")
    return { decision: "Requested", transaction: taken };
  if (query.installationId === undefined) return { decision: "Unexpected" };
  return {
    decision: "Claim",
    transaction: taken,
    installationId: query.installationId,
  };
}

/** The parameter the repositories page reads the landing's outcome from. */
export const forgeSetupStatusParam = "connected";

/**
 * Where the landing sends the person, with the outcome on it. The state and
 * the installation identity are not: what the next page draws is one word.
 */
export function forgeSetupReturn(returnPath: string, status: string): string {
  const joined = returnPath.includes("?") ? "&" : "?";
  const encoded = encodeURIComponent(status);
  return `${returnPath}${joined}${forgeSetupStatusParam}=${encoded}`;
}
