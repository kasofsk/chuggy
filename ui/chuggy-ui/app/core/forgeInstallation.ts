/**
 * Connecting a forge account: the one-time state this console mints before it
 * sends somebody to the forge, and what a tenant's claims say about each
 * account they came back with.
 *
 * THE STATE IS THE CONSOLE'S AND NOT THE API'S. Nothing on the wire mints one,
 * so it is drawn, stored under one key and taken once — the arrangement
 * `sessionHolder.ts` already uses for the authorization state — and a setup
 * landing reached a second time finds nothing to match against.
 */

import type {
  ForgeAccountKindName,
  ForgeAppName,
} from "../../../../src/contract/rosters.ts";
import type {
  ForgeInstallationClaimedResponse,
  ForgeInstallationResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import type { KeyValuePort } from "./sessionHolder.ts";

/** Where the transaction is held, which is `sessionStorage` and not the URL. */
export const forgeInstallTransactionKey = "chuggy.forgeInstall";

/** The entropy the state is drawn with, as the authorization state is drawn. */
export const forgeInstallStateBytesCount = 32;

/** What the console remembers while the person is away at the forge. */
export interface ForgeInstallTransaction {
  readonly state: string;
  readonly app: ForgeAppName;
  readonly tenant: string;
  readonly project: string;
  /** Where the person pressed Connect, which the landing sends them back to. */
  readonly returnPath: string;
}

export function forgeInstallState(
  drawBytes: (count: number) => Uint8Array,
): string {
  return base64urlFromBytes(drawBytes(forgeInstallStateBytesCount));
}

export function forgeInstallBegin(
  store: KeyValuePort,
  transaction: ForgeInstallTransaction,
): void {
  store.write(forgeInstallTransactionKey, JSON.stringify(transaction));
}

/** Read once and removed, so a landing opened twice matches nothing the second
 * time. */
export function forgeInstallTake(
  store: KeyValuePort,
): ForgeInstallTransaction | undefined {
  const stored = store.read(forgeInstallTransactionKey);
  store.remove(forgeInstallTransactionKey);
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    return forgeInstallTransactionOf(parsed);
  } catch {
    return undefined;
  }
}

function forgeInstallTransactionOf(
  parsed: unknown,
): ForgeInstallTransaction | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const fields = parsed as Record<string, unknown>;
  const app = fields["app"];
  if (app !== "portal" && app !== "worker") return undefined;
  const state = fields["state"];
  const tenant = fields["tenant"];
  const project = fields["project"];
  const returnPath = fields["returnPath"];
  if (typeof state !== "string" || typeof tenant !== "string") return undefined;
  if (typeof project !== "string" || typeof returnPath !== "string")
    return undefined;
  return { state, app, tenant, project, returnPath };
}

/**
 * The address to follow, with the state appended. The api builds `installUrl`
 * from an app's `html_url` and refuses one that already carries a query, so
 * this is the whole of what the address has on it.
 */
export function forgeInstallUrl(installUrl: string, state: string): string {
  return `${installUrl}?state=${encodeURIComponent(state)}`;
}

/** One of the two apps, as a person reads its name. */
export function forgeAppLabel(app: ForgeAppName): string {
  switch (app) {
    case "portal":
      return "Portal";
    case "worker":
      return "Worker";
  }
}

export const forgeAppStandings = ["Installed", "Missing"] as const;

export type ForgeAppStanding = (typeof forgeAppStandings)[number];

/** One account a tenant has claimed something on, and which apps it holds. */
export interface ForgeAccountRow {
  readonly account: string;
  readonly kind: ForgeAccountKindName;
  readonly portal: ForgeAppStanding;
  readonly worker: ForgeAppStanding;
}

function forgeAppStanding(
  claims: readonly ForgeInstallationResponse[],
  app: ForgeAppName,
): ForgeAppStanding {
  return claims.some((claim) => claim.app === app) ? "Installed" : "Missing";
}

/**
 * One row per account, in the order the listing answers, which is oldest claim
 * first. An account is named by both apps or by one, and the row says which.
 */
export function forgeAccountRows(
  installations: readonly ForgeInstallationResponse[],
): readonly ForgeAccountRow[] {
  const rows: ForgeAccountRow[] = [];
  for (const claim of installations) {
    if (rows.some((row) => row.account === claim.account)) continue;
    const claims = installations.filter(
      (held) => held.account === claim.account,
    );
    rows.push({
      account: claim.account,
      kind: claim.accountKind,
      portal: forgeAppStanding(claims, "portal"),
      worker: forgeAppStanding(claims, "worker"),
    });
  }
  return rows;
}

/**
 * The accounts a repository may be created under, which are the accounts whose
 * row says both apps. A create makes the repository through one app's
 * installation and leaves the work to the other's, so an account holding one of
 * them is an account a create would half-finish.
 */
export function forgeCreatingAccounts(
  installations: readonly ForgeInstallationResponse[],
): readonly string[] {
  return forgeAccountRows(installations)
    .filter((row) => row.portal === "Installed" && row.worker === "Installed")
    .map((row) => row.account);
}

/** The claims a repository listing is read under: the portal app's, which is
 * the one whose installation grants what a project may bind. */
export function forgePortalInstallations(
  installations: readonly ForgeInstallationResponse[],
): readonly ForgeInstallationResponse[] {
  return installations.filter((claim) => claim.app === "portal");
}

/** What a claim came to, as the one word the landing and the page draw. */
export type ForgeClaimOutcome =
  | {
      readonly outcome: "Claimed";
      readonly installation: ForgeInstallationClaimedResponse;
    }
  | { readonly outcome: "Refused"; readonly status: string };

/**
 * The refusals this route answers, in the console's own words.
 *
 * `ForgeNotConfigured` and `InstallationUnknown` are both `404` and
 * `src/contract/outcomes.ts` folds every `404` into `Absent` without its code,
 * so the console cannot tell them apart and says the one thing that is true of
 * both: the installation is not one this deployment knows — a `404` read for
 * its code is the follow-up that would separate them, and is not this step's.
 */
export function forgeClaimOutcome(
  result: ApiResult<ForgeInstallationClaimedResponse>,
): ForgeClaimOutcome {
  switch (result.outcome) {
    case "Ok":
      return { outcome: "Claimed", installation: result.value };
    case "Conflict":
      return {
        outcome: "Refused",
        status:
          result.code === "InstallationClaimed"
            ? "Claimed by another tenant"
            : "Conflict",
      };
    case "Absent":
      return { outcome: "Refused", status: "Unknown" };
    case "Retryable":
      return { outcome: "Refused", status: "Deferring" };
    case "Unauthenticated":
      return { outcome: "Refused", status: "Not signed in" };
    case "Rejected":
      return { outcome: "Refused", status: "Refused" };
    case "Fault":
      return { outcome: "Refused", status: "Failed" };
    case "Unreachable":
      return { outcome: "Refused", status: "Unreachable" };
    case "Unreadable":
      return { outcome: "Refused", status: "Unreadable" };
  }
}
