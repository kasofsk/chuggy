/**
 * A forge installation: the account a tenant claimed an app on, and the tokens
 * minted under it for one repository at a time.
 *
 * THE ROW IS READ BY THE TENANT AND THE ACCOUNT TOGETHER, so a claim another
 * tenant made is a missing claim here. A repository's owner selects the
 * installation and the asking tenant decides whether it may be read at all;
 * nothing above this holds an installation identity, and a repository no claim
 * of this tenant's covers has no credential rather than a wider one.
 *
 * A MINT ANSWERS THE THREE WAYS `CredentialResolved` DOES. A forge that refused
 * this app is `Denied` and settled for as long as the composition stands; a
 * forge that could not be reached, would not answer, or answered something this
 * side cannot read is `Unavailable` and may be asked again. Nothing falls open.
 *
 * A PERMISSION SET IS NAMED HERE AND SPELLED BY THE ADAPTER. The sets this tree
 * asks for are the vocabulary of what an act needs — read a snapshot, push a
 * branch, open a change proposal, make a repository and reserve its default
 * branch — and the forge's own spelling of each is the adapter's, so a second
 * forge names the same ones.
 *
 * A TOKEN IS A VALUE AND IS NEVER PART OF AN IDENTITY. It reaches one header
 * and one credential brand; no refusal here carries a message, so a mint that
 * failed cannot quote what it was minting.
 */

import { asBoundedText } from "./boundedText.ts";
import { finalizerIdentityCharsMax, type RepositoryId } from "./finalizer.ts";
import type { TenantId } from "./projectStore.ts";

declare const forgeIdBrand: unique symbol;
declare const forgeAccountBrand: unique symbol;
declare const forgeRepositoryNameBrand: unique symbol;
declare const forgeInstallationIdBrand: unique symbol;
declare const forgeInstallationTokenBrand: unique symbol;

/** The forge a row names, which is what selects the adapter that answers for it. */
export type ForgeId = string & { readonly [forgeIdBrand]: true };

/** One account on a forge, which is the owner half of every repository under it. */
export type ForgeAccount = string & { readonly [forgeAccountBrand]: true };

/** One repository as its own forge names it, without the account that owns it. */
export type ForgeRepositoryName = string & {
  readonly [forgeRepositoryNameBrand]: true;
};

/** The identity a forge gave one installation of one app on one account. */
export type ForgeInstallationId = string & {
  readonly [forgeInstallationIdBrand]: true;
};

/** A minted credential, opaque and bounded as the rows that never hold it are. */
export type ForgeInstallationToken = string & {
  readonly [forgeInstallationTokenBrand]: true;
};

/**
 * Every forge this tree has an adapter for, and the roster a supplied forge is
 * narrowed against. It is a roster rather than one constant because a request
 * body names a forge, and a body checked against nothing would name one no
 * adapter answers for.
 */
export const allForgeIds = ["github"] as const;

/** The forge this tree has an adapter for. */
export const githubForgeId = allForgeIds[0] as ForgeId;

/** Every app a tenant installs, and the declaration `ForgeApp` derives from. */
export const allForgeApps = ["portal", "worker"] as const;

export type ForgeApp = (typeof allForgeApps)[number];

/**
 * The app a pod's git credential is minted under, which is never the one a
 * person's browser session acts through. The branch ruleset admits the portal
 * App to update a protected branch, so a work attempt's write token minted
 * under it would let an agent-executed pod push to main; the worker App is the
 * one that ruleset refuses, which is what makes it the pod's.
 */
export const workerPodForgeApp: ForgeApp = "worker";

/** Every kind of account a forge installs an app on. */
export const allForgeAccountKinds = ["User", "Organization"] as const;

export type ForgeAccountKind = (typeof allForgeAccountKinds)[number];

/** Every permission set an act in this tree asks a forge for. */
export const allForgePermissionSets = [
  "read",
  "write",
  "propose",
  "administer",
] as const;

export type ForgePermissionSet = (typeof allForgePermissionSets)[number];

/**
 * What one minted token may do to the repository it is scoped to.
 * `administration` is what makes a repository and what reserves its default
 * branch, and it is the one permission a token minted before a repository
 * exists is for, so it is named apart from what a token does to contents.
 */
export interface ForgeRepositoryPermissions {
  readonly contents: "read" | "write";
  readonly changeProposals?: "write";
  readonly administration?: "write";
}

/**
 * What each named set asks for. The record is exhaustive over
 * `ForgePermissionSet`, so a set added to the roster without permissions here
 * is a compile error rather than a mint that asks for nothing.
 */
export const forgePermissionSets: Readonly<
  Record<ForgePermissionSet, ForgeRepositoryPermissions>
> = {
  read: { contents: "read" },
  write: { contents: "write" },
  propose: { contents: "write", changeProposals: "write" },
  administer: { contents: "write", administration: "write" },
};

/** The segments a forge addresses an account or a repository by. */
const forgeSegmentPattern = /^[A-Za-z0-9._-]+$/u;

/** The digits a forge writes an installation identity as. */
const forgeInstallationIdPattern = /^[1-9][0-9]*$/u;

function forgeSegment(value: string, what: string): string {
  const bounded = asBoundedText(value, what, finalizerIdentityCharsMax);
  if (!forgeSegmentPattern.test(bounded))
    throw new RangeError(`${what}: ${value} is not a forge segment`);
  return bounded;
}

/** Brands the forge one row names. */
export function asForgeId(value: string): ForgeId {
  return forgeSegment(value, "forge") as ForgeId;
}

/** Brands one account on a forge. */
export function asForgeAccount(value: string): ForgeAccount {
  return forgeSegment(value, "forge account") as ForgeAccount;
}

/** Brands one repository's own name on its forge. */
export function asForgeRepositoryName(value: string): ForgeRepositoryName {
  return forgeSegment(value, "forge repository") as ForgeRepositoryName;
}

/** Brands an installation identity, which a forge writes as a positive integer. */
export function asForgeInstallationId(value: string): ForgeInstallationId {
  if (!forgeInstallationIdPattern.test(value))
    throw new RangeError("forge installation is not a positive integer");
  return asBoundedText(
    value,
    "forge installation",
    finalizerIdentityCharsMax,
  ) as ForgeInstallationId;
}

/** Brands a minted token, bounded as every other opaque credential is. */
export function asForgeInstallationToken(
  value: string,
): ForgeInstallationToken {
  return asBoundedText(
    value,
    "forge installation token",
    finalizerIdentityCharsMax,
  ) as ForgeInstallationToken;
}

/** Narrows text to the app it names, refusing anything no key is held for. */
export function asForgeApp(value: string): ForgeApp {
  const app = allForgeApps.find((known) => known === value);
  if (app === undefined)
    throw new RangeError(`forge app: ${value} is not a known app`);
  return app;
}

/** Narrows text to the account kind it names. */
export function asForgeAccountKind(value: string): ForgeAccountKind {
  const kind = allForgeAccountKinds.find((known) => known === value);
  if (kind === undefined)
    throw new RangeError(`forge account kind: ${value} is not a known kind`);
  return kind;
}

/** One app installed on one account, read under the tenant that claimed it. */
export interface ForgeInstallation {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly account: ForgeAccount;
  readonly installationId: ForgeInstallationId;
}

/**
 * Which installation to read. The tenant is part of the question rather than
 * part of the answer, so a caller cannot read a row and forget to compare it.
 */
export interface ForgeInstallationQuery {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly account: ForgeAccount;
  readonly tenant: TenantId;
}

/** Where the claimed installations are read from, which is never the forge. */
export interface ForgeInstallationStore {
  installation(
    query: ForgeInstallationQuery,
  ): Promise<ForgeInstallation | undefined>;
}

/**
 * What one mint asks for: an installation, the repositories it is scoped to,
 * and what it may do. NAMING NO REPOSITORY IS NOT NAMING AN EMPTY LIST — a
 * token scoped to nothing is not a token and is refused where it is spelled,
 * while naming none at all is the whole installation, which is what a caller
 * enumerating an installation's repositories must ask for and no caller acting
 * on one may.
 */
export interface ForgeTokenRequest {
  readonly installation: ForgeInstallation;
  readonly repositories?: readonly ForgeRepositoryName[] | undefined;
  readonly permissions: ForgePermissionSet;
}

/** What minting came to, a refusal kept apart from an outage all the way out. */
export type ForgeTokenMinted =
  | {
      readonly minted: "Token";
      readonly token: ForgeInstallationToken;
      readonly expiresAtMs: number;
    }
  | { readonly minted: "Denied" }
  | { readonly minted: "Unavailable" };

/** Mints installation tokens against one forge, as the app whose key it holds. */
export interface ForgeInstallationTokens {
  mint(request: ForgeTokenRequest): Promise<ForgeTokenMinted>;
}

/**
 * A token for one repository, which is what every caller in this tree wants:
 * the owner in the repository's own address is what selects the installation,
 * so nothing above this names an account or an installation identity. The
 * tenant is the one asking, not the one the account turns out to belong to.
 */
export interface ForgeRepositoryTokens {
  token(
    repository: RepositoryId,
    tenant: TenantId,
    permissions: ForgePermissionSet,
  ): Promise<ForgeTokenMinted>;
}
