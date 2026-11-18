/**
 * A project's access tokens made, listed and deleted for a caller.
 *
 * MINTING NEEDS `MakeAccessTokens`, AND THE MAKER IS ALWAYS THE CALLER. A
 * caller who may not read the project is answered as though it did not exist;
 * a reader without the permit is refused apart from that. A reader sees and
 * deletes their own tokens, and a holder of `Administer` every token, with its
 * maker. A token the caller may not see is answered as one that does not exist.
 * Deleting is revoking: the row goes.
 *
 * THE SECRET IS DRAWN AND DIGESTED BEHIND `AccessTokenSecrets`, and only the
 * digest reaches the store. The mint's answer is the one place the secret is
 * held after that, so no error, log line or other answer can carry it.
 *
 * NOTHING DELETES A TOKEN WHEN ITS MAKER LOSES ACCESS. It is refused because
 * Keto refuses them, works again if they are re-added, and its expiry bounds
 * both. Whoever removes a person may delete their tokens in Settings.
 */

import {
  accessTokenLifetimeDaysMax,
  accessTokenPattern,
  isAccessTokenName,
  type AccessTokenAccess,
  type AccessTokenMintRequest,
} from "../contract/accessToken.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** One token as it is kept, without its digest. */
export interface AccessTokenRecord {
  readonly token: string;
  readonly name: string;
  readonly access: AccessTokenAccess;
  readonly maker: Principal;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** One drawn secret, the identity its row is keyed by, and the digest its row keeps. */
export interface AccessTokenSecretMinted {
  readonly token: string;
  readonly secret: string;
  readonly secretDigest: string;
}

/** Where a token's identity and secret are drawn and its digest taken, together. */
export interface AccessTokenSecrets {
  mint(): AccessTokenSecretMinted;
}

/** What the durable side's mint came to. */
export type AccessTokenWritten =
  | { readonly written: "Minted"; readonly record: AccessTokenRecord }
  | { readonly written: "NotFound" }
  | { readonly written: "LimitReached"; readonly bound: "Held" | "Project" }
  | { readonly written: "NameTaken" };

/** What one mint writes: everything a row holds but its times, which the store's clock sets. */
export interface AccessTokenMinting {
  readonly token: string;
  readonly name: string;
  readonly access: AccessTokenAccess;
  readonly maker: Principal;
  readonly secretDigest: string;
  readonly lifetimeDays: number;
}

/**
 * The durable side. `mint` counts and inserts under a lock no concurrent mint
 * in the project passes; `listed` and `deleted` read and delete a maker's
 * tokens where one is named, and every token of the project where none is.
 */
export interface AccessTokenStore {
  mint(
    partition: Partition,
    minting: AccessTokenMinting,
  ): Promise<AccessTokenWritten>;
  listed(
    partition: Partition,
    maker: Principal | undefined,
  ): Promise<readonly AccessTokenRecord[]>;
  deleted(
    partition: Partition,
    token: string,
    maker: Principal | undefined,
  ): Promise<boolean>;
}

/** What a mint answers. */
export type AccessTokenMinted =
  | { readonly result: "NotFound" }
  | { readonly result: "Forbidden" }
  | { readonly result: "LimitReached"; readonly bound: "Held" | "Project" }
  | { readonly result: "NameTaken" }
  | {
      readonly result: "Minted";
      readonly value: AccessTokenRecord & { readonly secret: string };
    };

/** What a list answers. */
export type AccessTokensListed =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly value: readonly AccessTokenRecord[] };

/** What a delete answers. */
export type AccessTokenDeleted = "Deleted" | "NotFound";

export interface AccessTokenService {
  mint(
    principal: Principal,
    partition: Partition,
    request: AccessTokenMintRequest,
  ): Promise<AccessTokenMinted>;
  listed(
    principal: Principal,
    partition: Partition,
  ): Promise<AccessTokensListed>;
  deleted(
    principal: Principal,
    partition: Partition,
    token: string,
  ): Promise<AccessTokenDeleted>;
}

/** Whose tokens a reader reaches: every one for an administrator, else their own, or nothing for a caller who may not read the project. */
async function accessTokenReach(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<{ readonly maker: Principal | undefined } | undefined> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return undefined;
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  return { maker: administers ? undefined : principal };
}

/** A mint by the caller, as its maker. */
export async function accessTokenMint(
  access: ProjectAccess,
  store: AccessTokenStore,
  secrets: AccessTokenSecrets,
  principal: Principal,
  partition: Partition,
  request: AccessTokenMintRequest,
): Promise<AccessTokenMinted> {
  if (!isAccessTokenName(request.name))
    throw new RangeError("access token name is not one line of bounded text");
  if (
    !Number.isSafeInteger(request.lifetimeDays) ||
    request.lifetimeDays < 1 ||
    request.lifetimeDays > accessTokenLifetimeDaysMax
  )
    throw new RangeError("access token lifetime is past its bound");
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  if (
    (await access.authorize(principal, partition, "MakeAccessTokens")) ===
    undefined
  )
    return { result: "Forbidden" };
  const drawn = secrets.mint();
  if (!accessTokenPattern.test(drawn.secret))
    throw new Error("a drawn access token is outside the token language");
  const written = await store.mint(partition, {
    token: drawn.token,
    name: request.name,
    access: request.access,
    maker: principal,
    secretDigest: drawn.secretDigest,
    lifetimeDays: request.lifetimeDays,
  });
  switch (written.written) {
    case "Minted":
      return {
        result: "Minted",
        value: { ...written.record, secret: drawn.secret },
      };
    case "NotFound":
      return { result: "NotFound" };
    case "LimitReached":
      return { result: "LimitReached", bound: written.bound };
    case "NameTaken":
      return { result: "NameTaken" };
    default:
      return assertNever(written);
  }
}

/** The tokens the caller may see, newest first. */
export async function accessTokensListed(
  access: ProjectAccess,
  store: AccessTokenStore,
  principal: Principal,
  partition: Partition,
): Promise<AccessTokensListed> {
  const reach = await accessTokenReach(access, principal, partition);
  if (reach === undefined) return { result: "NotFound" };
  return { result: "Found", value: await store.listed(partition, reach.maker) };
}

/** One token deleted by its maker or an administrator. */
export async function accessTokenDeleted(
  access: ProjectAccess,
  store: AccessTokenStore,
  principal: Principal,
  partition: Partition,
  token: string,
): Promise<AccessTokenDeleted> {
  const reach = await accessTokenReach(access, principal, partition);
  if (reach === undefined) return "NotFound";
  return (await store.deleted(partition, token, reach.maker))
    ? "Deleted"
    : "NotFound";
}

export function accessTokenService(input: {
  readonly access: ProjectAccess;
  readonly store: AccessTokenStore;
  readonly secrets: AccessTokenSecrets;
}): AccessTokenService {
  return {
    mint: (principal, partition, request) =>
      accessTokenMint(
        input.access,
        input.store,
        input.secrets,
        principal,
        partition,
        request,
      ),
    listed: (principal, partition) =>
      accessTokensListed(input.access, input.store, principal, partition),
    deleted: (principal, partition, token) =>
      accessTokenDeleted(
        input.access,
        input.store,
        principal,
        partition,
        token,
      ),
  };
}
