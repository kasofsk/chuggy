/**
 * A project's access tokens, decided with no renderer: what a mint's form may
 * hold before it is sent, where a token stands at a given instant, the days
 * it has left while it nears its end, and the line a refused mint or deletion
 * is drawn as.
 *
 * THE CLOCK IS HANDED IN. A token's standing is a function of its expiry and
 * the instant asked, so a page draws it on its own clock and a case asks it
 * at any instant it names.
 *
 * THE SECRET IS IN A MINT'S ANSWER AND NOWHERE AFTER IT. Nothing here keeps
 * one, and the list a row is drawn from never carries it.
 */

import {
  accessTokenLimitReachedCode,
  accessTokenMintForbiddenCode,
  accessTokenMintRequestSchema,
  accessTokenNameCharsMax,
  accessTokenNameTakenCode,
  accessTokenWarningDays,
  isAccessTokenName,
  type AccessTokenAccess,
  type AccessTokenMintRequest,
} from "../../../../src/contract/accessToken.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
import { accessFailureLabel } from "./tenantPeople.ts";

const accessTokenMsPerDay = 24 * 60 * 60 * 1000;

/** The lifetimes a mint offers, in days, the longest a year. */
export const accessTokenLifetimesDays = [7, 30, 60, 90, 365] as const;

export type AccessTokenLifetimeDays = (typeof accessTokenLifetimesDays)[number];

/** One lifetime as its choice is labelled. */
export function accessTokenLifetimeLabel(days: AccessTokenLifetimeDays): Copy {
  switch (days) {
    case 7:
    case 30:
    case 60:
    case 90:
      return {
        id: "settings-access-tokens-lifetime-days",
        args: { days },
      };
    case 365:
      return { id: "settings-access-tokens-lifetime-year" };
  }
}

/** One access as its choice and its cell are labelled. */
export function accessTokenAccessLabel(access: AccessTokenAccess): Copy {
  switch (access) {
    case "Read":
      return { id: "settings-access-tokens-read" };
    case "Write":
      return { id: "settings-access-tokens-write" };
  }
}

/** What a mint's dialog holds before it is sent. */
export interface AccessTokenForm {
  readonly name: string;
  readonly access: AccessTokenAccess;
  readonly lifetimeDays: AccessTokenLifetimeDays;
}

/** What every opening of the dialog starts from: no name, Read, for a month. */
export const accessTokenFormBlank: AccessTokenForm = {
  name: "",
  access: "Read",
  lifetimeDays: 30,
};

export function accessTokenMintBody(
  form: AccessTokenForm,
): AccessTokenMintRequest {
  return {
    name: form.name.trim(),
    access: form.access,
    lifetimeDays: form.lifetimeDays,
  };
}

/** Whether the contract would take the form as it stands. */
export function accessTokenMintSendable(form: AccessTokenForm): boolean {
  return accessTokenMintRequestSchema.safeParse(accessTokenMintBody(form))
    .success;
}

/** What is wrong with a name typed, and nothing before one is typed. */
export function accessTokenNameFault(name: string): Copy | undefined {
  const trimmed = name.trim();
  if (trimmed === "" || isAccessTokenName(trimmed)) return undefined;
  return {
    id: "settings-access-tokens-name-long",
    args: { chars: accessTokenNameCharsMax },
  };
}

/** Where a token stands: in use, nearing its expiry, or past it. */
export const accessTokenStatuses = ["Active", "Expiring", "Expired"] as const;

export type AccessTokenStatus = (typeof accessTokenStatuses)[number];

function accessTokenExpiresMs(expiresAt: string): number {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs))
    throw new Error(`an access token's expiry is no instant: ${expiresAt}`);
  return expiresMs;
}

/** Expired from its expiry on, and Expiring from `accessTokenWarningDays`
 * before it. */
export function accessTokenStatusAt(
  expiresAt: string,
  nowMs: number,
): AccessTokenStatus {
  const leftMs = accessTokenExpiresMs(expiresAt) - nowMs;
  if (leftMs <= 0) return "Expired";
  if (leftMs <= accessTokenWarningDays * accessTokenMsPerDay) return "Expiring";
  return "Active";
}

/** The whole days an Expiring token has left, counting a part day as one,
 * and nothing for a token in any other standing. */
export function accessTokenDaysLeft(
  expiresAt: string,
  nowMs: number,
): number | undefined {
  if (accessTokenStatusAt(expiresAt, nowMs) !== "Expiring") return undefined;
  const days = Math.ceil(
    (accessTokenExpiresMs(expiresAt) - nowMs) / accessTokenMsPerDay,
  );
  if (days < 1 || days > accessTokenWarningDays)
    throw new Error(`an Expiring token has ${String(days)} days left`);
  return days;
}

export function accessTokenStatusLabel(status: AccessTokenStatus): Copy {
  switch (status) {
    case "Active":
      return { id: "settings-access-tokens-active" };
    case "Expiring":
      return { id: "settings-access-tokens-expiring" };
    case "Expired":
      return { id: "settings-access-tokens-expired" };
  }
}

/** The line a refused mint is drawn as: the mint's own codes by name, and
 * any other answer as the access plane's line for it. */
export function accessTokenMintRefusal(failure: ApiFailure): Copy {
  if (failure.outcome === "Conflict" || failure.outcome === "Rejected") {
    switch (failure.code) {
      case accessTokenMintForbiddenCode:
        return { id: "settings-access-tokens-forbidden" };
      case accessTokenLimitReachedCode:
        return { id: "settings-access-tokens-limit" };
      case accessTokenNameTakenCode:
        return { id: "settings-access-tokens-name-taken" };
      default:
        break;
    }
  }
  return accessFailureLabel(failure);
}

/** What a deletion leaves to be said: nothing where it was done or the token
 * was already gone, and the refusal's line otherwise. */
export function accessTokenDeletionNote(
  result: ApiResult<undefined>,
): Copy | undefined {
  if (result.outcome === "Ok" || result.outcome === "Absent") return undefined;
  return accessFailureLabel(result);
}

/** The words of the page and its list. */
export const accessTokensWords = {
  title: { id: "settings-access-tokens-title" },
  about: { id: "settings-access-tokens-about" },
  none: { id: "settings-access-tokens-none" },
  create: { id: "settings-access-tokens-create" },
  name: { id: "settings-access-tokens-name" },
  access: { id: "settings-access-tokens-access" },
  created: { id: "settings-access-tokens-created" },
  expires: { id: "settings-access-tokens-expires" },
  status: { id: "settings-access-tokens-status" },
  maker: { id: "settings-access-tokens-maker" },
  delete: { id: "settings-access-tokens-delete" },
  deleteLine: { id: "settings-access-tokens-delete-line" },
} as const satisfies Readonly<Record<string, Copy>>;

/** The words of the dialog that makes one. */
export const accessTokenMintWords = {
  own: { id: "settings-access-tokens-own" },
  send: { id: "settings-access-tokens-send" },
  sending: { id: "settings-creating" },
  secret: { id: "settings-access-tokens-secret" },
  copy: { id: "settings-access-tokens-copy" },
  shownOnce: { id: "settings-access-tokens-shown-once" },
  use: { id: "settings-access-tokens-use" },
  how: { id: "settings-access-tokens-how" },
} as const satisfies Readonly<Record<string, Copy>>;

/** chuggy-docs' page on using a token. */
export const accessTokenDocsAddress =
  "https://github.com/kasofsk/chuggy-docs/blob/main/docs/access-tokens.md";

export function accessTokenDaysLeftLabel(days: number): Copy {
  return {
    id: "settings-access-tokens-days-left",
    args: { days },
  };
}

export function accessTokenDeletionQuestion(name: string): Copy {
  return { id: "settings-access-tokens-delete-question", args: { name } };
}
