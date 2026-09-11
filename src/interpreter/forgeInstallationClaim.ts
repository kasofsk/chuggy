/**
 * Recording that a tenant claimed a forge app on an account: what one claim
 * carries, and what recording it came to.
 *
 * IT STANDS APART FROM THE PORT THE API MINTS THROUGH because a claim is
 * administration and minting is an act: the one writer this slice has is the
 * provisioning root, and a read port that also declared a write would be handed
 * to every process that only reads.
 *
 * THE AUTHORITY IS THE AUDITED ONE. It says who claimed, as every other audited
 * row does, and it decides nothing: what a principal may do is the relation
 * authority's question.
 */

import type { Authority } from "./operationInbox.ts";
import type {
  ForgeAccount,
  ForgeAccountKind,
  ForgeApp,
  ForgeId,
  ForgeInstallationId,
} from "./forgeInstallation.ts";
import type { TenantId } from "./projectStore.ts";

/** One claim, every identity in it already narrowed. */
export interface ForgeInstallationClaim {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly account: ForgeAccount;
  readonly accountKind: ForgeAccountKind;
  readonly installationId: ForgeInstallationId;
  readonly tenant: TenantId;
  readonly authority: Authority;
}

/** Every outcome the claim door answers with, and the declaration its type derives from. */
export const allForgeInstallationRecorded = [
  "Recorded",
  "AlreadyRecorded",
  "Reinstalled",
  "ClaimedElsewhere",
] as const;

export type ForgeInstallationRecorded =
  (typeof allForgeInstallationRecorded)[number];

/** Records one claim, and nothing else. */
export interface ForgeInstallationRecording {
  record(claim: ForgeInstallationClaim): Promise<ForgeInstallationRecorded>;
}

/**
 * One claim as it is read back. The authority that made it is not part of it:
 * it says who acted and decides nothing, so a reader handed it would hold an
 * identity it has no question to ask of.
 */
export interface ForgeInstallationClaimed {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly account: ForgeAccount;
  readonly accountKind: ForgeAccountKind;
  readonly installationId: ForgeInstallationId;
  readonly claimedAt: string;
}

/**
 * Every claim one tenant holds, oldest first. The tenant is the whole of the
 * question for `forgeInstallation.ts`'s reason: a claim another tenant made is
 * one this tenant cannot read at all, so a caller cannot be handed a row it
 * would have had to remember to compare.
 */
export interface ForgeInstallationClaims {
  claims(tenant: TenantId): Promise<readonly ForgeInstallationClaimed[]>;
}
