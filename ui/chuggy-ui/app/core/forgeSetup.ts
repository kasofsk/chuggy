/**
 * The setup landing's decisions: what the forge sent back after an install, and
 * whether it belongs to the transaction this tab started.
 *
 * The landing claims nothing itself. An install it can match starts the
 * authorization that proves which accounts are the person's; a state that does
 * not match the stored transaction — or a landing reached with nothing stored,
 * which is what a replay looks like once the transaction has been taken — is
 * refused and sends the person nowhere.
 *
 * AN UPDATE IT CANNOT MATCH IS NOT REFUSED. The forge sends that return to
 * whoever saves an installation's settings, from its own pages as much as from
 * a link this console drew, so it is somebody's ordinary way back and is
 * answered as one: nothing is started and nothing claimed, and the way on is
 * the page this tab left by where it stored one.
 */

import type { ForgeInstallTransaction } from "./forgeInstallation.ts";
import type { ForgePress } from "./forgePress.ts";
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
  | { readonly decision: "Updated"; readonly press: ForgePress | undefined }
  | { readonly decision: "Unexpected" };

/** The landing's one line for a return it cannot place. */
export const forgeSetupUnexpected = "Not expected";

/** The landing's one line for an update it cannot place, which says only where
 * the person has come from: what they saved there is not this console's to say. */
export const forgeSetupUpdated = "Back from GitHub";

/** What the landing returns with for an install an organization's owner has to approve. */
export const forgeSetupRequested: ForgeReturnWord = {
  standing: "Unfinished",
  status: "Requested",
};

/** The press a stored transaction carries, less the state its taking spent. */
function forgeSetupPress(taken: ForgeInstallTransaction): ForgePress {
  return {
    tenant: taken.tenant,
    returnPath: taken.returnPath,
    installs: taken.installs,
  };
}

/**
 * What the landing does with what it was handed. The state is compared against
 * the transaction this tab stored, so a return carrying somebody else's state —
 * or none — starts nothing, an update being the one such return answered rather
 * than refused, with the press this tab stored where it stored one.
 */
export function forgeSetupDecision(
  query: ForgeSetupQuery,
  taken: ForgeInstallTransaction | undefined,
): ForgeSetupDecision {
  const matched = taken !== undefined && query.state === taken.state;
  if (!matched)
    return query.action === "update"
      ? {
          decision: "Updated",
          press: taken === undefined ? undefined : forgeSetupPress(taken),
        }
      : { decision: "Unexpected" };
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
