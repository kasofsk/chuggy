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
