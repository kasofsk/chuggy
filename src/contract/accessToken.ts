/**
 * A project's access tokens: what one is, what minting one asks for, and what
 * listing and minting answer.
 *
 * A TOKEN ACTS AS ITS MAKER IN ONE PROJECT, made by a person for a script that
 * runs without them, shown once and kept only as its digest, until it is
 * deleted or expires.
 *
 * `accessTokenPrefix` ROUTES AND `accessTokenPattern` ADMITS, as
 * `src/adapters/http/sessionBearer.ts`'s header argues of a session bearer's.
 * No compact JWS, session bearer or hex pool bearer begins with the prefix, and
 * the pattern is 32 random bytes as unpadded base64url behind it, compared
 * exactly, so `CHGP_` is no token.
 */

import { z } from "zod";

import { identitySchema, instantSchema, isBoundedText } from "./http.ts";

/** What every secret begins with, which routes it. */
export const accessTokenPrefix = "chgp_";

/** The whole language of a secret, which admits it. */
export const accessTokenPattern = /^chgp_[A-Za-z0-9_-]{43}$/u;

/** What a token may do as its maker. */
export const accessTokenAccesses = ["Read", "Write"] as const;
export type AccessTokenAccess = (typeof accessTokenAccesses)[number];

/** The longest name, in code points. */
export const accessTokenNameCharsMax = 64;

/** The longest a token may stand, in days. */
export const accessTokenLifetimeDaysMax = 366;

/** The most tokens one maker holds in one project, expired ones until they are deleted. */
export const accessTokensHeldMax = 16;

/** The most tokens one project holds, so a list is one answer. */
export const accessTokensProjectMax = 64;

/** The header an answer to a token names its expiry in. */
export const accessTokenExpiresHeader = "chuggy-access-token-expires";

/** How many days before its expiry a token is marked Expiring. */
export const accessTokenWarningDays = 7;

/** The 403 a mint is refused with by a caller not holding `make_access_tokens`. */
export const accessTokenMintForbiddenCode = "AccessTokenMintForbidden";

/** The 409 a mint is refused with at either bound. */
export const accessTokenLimitReachedCode = "AccessTokenLimitReached";

/** The 409 a mint is refused with where its maker already holds the name in the project. */
export const accessTokenNameTakenCode = "AccessTokenNameTaken";

/** Whether `value` is a name: bounded text on one line that is not blank. */
export function isAccessTokenName(value: string): boolean {
  return (
    isBoundedText(value, accessTokenNameCharsMax) &&
    /\S/u.test(value) &&
    !/[\n\r\u2028\u2029]/u.test(value)
  );
}

/** What one mint asks for. */
export const accessTokenMintRequestSchema = z.strictObject({
  name: z.string().refine(isAccessTokenName, {
    message: `a name is at most ${String(accessTokenNameCharsMax)} characters on one line and not blank`,
  }),
  access: z.enum(accessTokenAccesses),
  lifetimeDays: z.number().int().min(1).max(accessTokenLifetimeDaysMax),
});
export type AccessTokenMintRequest = z.infer<
  typeof accessTokenMintRequestSchema
>;

/** One token as it is listed, which never holds its secret. */
export const accessTokenSchema = z.strictObject({
  token: identitySchema,
  name: z.string(),
  access: z.enum(accessTokenAccesses),
  /** Who made it, encoded as a ticket's `creator` is. */
  maker: identitySchema,
  createdAt: instantSchema,
  expiresAt: instantSchema,
});
export type AccessTokenResponse = z.infer<typeof accessTokenSchema>;

/** A project's tokens the reader may see, newest first. */
export const accessTokensResponseSchema = z.strictObject({
  tokens: z.array(accessTokenSchema).max(accessTokensProjectMax),
});
export type AccessTokensResponse = z.infer<typeof accessTokensResponseSchema>;

/** What a mint answers: the token, and its secret, answered this once. */
export const accessTokenMintedResponseSchema = accessTokenSchema.extend({
  secret: z.string().regex(accessTokenPattern),
});
export type AccessTokenMintedResponse = z.infer<
  typeof accessTokenMintedResponseSchema
>;
