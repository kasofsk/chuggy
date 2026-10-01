/**
 * The setup landing's decisions: what the forge sent back after an install, and
 * whether it belongs to the transaction this tab started.
 *
 * The landing claims nothing itself. An install it can match starts the
 * authorization that proves which accounts are the person's; a state that does
 * not match the stored transaction — or a landing reached with nothing stored,
 * which is what a replay looks like once the transaction has been taken — is
 * refused and sends the person nowhere.
 */

import type { ForgeInstallTransaction } from "./forgeInstallation.ts";
import type { ForgeReturnWord } from "./forgeReturn.ts";

/** What the forge says the person did, which `request` alone has nothing to authorize for. */
export const forgeSetupActions = ["install", "update", "request"] as const;

export type ForgeSetupAction = (typeof forgeSetupActions)[number];

export interface ForgeSetupQuery {
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
    action: forgeSetupActionOf(search["setup_action"]),
    state: forgeSetupText(search["state"]),
  };
}

export type ForgeSetupDecision =
  | {
      readonly decision: "Authorize";
      readonly transaction: ForgeInstallTransaction;
    }
  | {
      readonly decision: "Requested";
      readonly transaction: ForgeInstallTransaction;
    }
  | { readonly decision: "Unexpected" };

/** The landing's one line for a return it cannot place. */
export const forgeSetupUnexpected = "Not expected";

/** What the landing returns with for an install an organization's owner has to approve. */
export const forgeSetupRequested: ForgeReturnWord = {
  standing: "Unfinished",
  status: "Requested",
};

/**
 * What the landing does with what it was handed. The state is compared against
 * the transaction this tab stored, so a return carrying somebody else's state —
 * or none — starts nothing.
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
  return { decision: "Authorize", transaction: taken };
}

/**
 * The address the landing is served at, which is what an operator sets as both
 * Apps' Setup URL on the forge. It is stated once here because changing it
 * breaks every install in a deployment already configured against it.
 */
export const forgeSetupRoutePath = "/forge/github/setup";
