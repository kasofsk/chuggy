/**
 * A device sign-in approved by the person signed in: the code they typed handed
 * to the issuer with the challenge its page carried, under a bound on how many
 * codes each person may have refused.
 *
 * THE BOUND IS PER PERSON. Each principal holds its own refusals, at most
 * `refusalsMax` inside any `windowMs`, so one stranger spending theirs locks
 * nobody else out, as a process-wide count would. A call in flight holds a
 * place in its caller's count until the issuer answers, and gives it back
 * unless the code was refused, so calls sent together cannot pass the bound.
 * The counts sit in one map of at most `principalsMax` people, the one
 * refused least recently evicted first.
 *
 * WHAT IT BUYS. A code is drawn from the issuer's alphabet of twenty letters,
 * eight long, and lives for the fabric's `ttl.device_user_code`, its fifteen
 * minutes. In any span as long as that life one person is refused at most
 * `refusalsMax` times for each `windowMs` it covers and once more over, and
 * each guess matches a code that is live with the chance of the live codes
 * over twenty to the eighth. A refusal the issuer answered for a fault of its
 * own counts too, since it answers both alike, and a refused code leaves the
 * challenge usable.
 *
 * WHAT IS LEFT. Guessing faster needs one account per bound, and the counts
 * are this process's, so they start again whenever the API does, as every
 * release does.
 */

import type { Principal } from "./principal.ts";

/** What the issuer answered a code: where the browser goes next, a code it did not accept, a challenge it no longer knows, or no answer it could be read by. */
export type DeviceUserCodeAnswer =
  | { readonly answer: "Accepted"; readonly redirectTo: string }
  | { readonly answer: "CodeRefused" }
  | { readonly answer: "LinkExpired" }
  | { readonly answer: "Unavailable" };

/** The issuer's acceptance of a device's code, which answers every fault as `Unavailable` rather than raising it. */
export interface DeviceUserCodes {
  accept(challenge: string, userCode: string): Promise<DeviceUserCodeAnswer>;
}

/** What one approval came to: the issuer's answer, or the caller's bound spent until the window reopens. */
export type DeviceApproved =
  | DeviceUserCodeAnswer
  | { readonly answer: "TriesSpent"; readonly retryAfterSecs: number };

export interface DeviceApprovals {
  approve(
    principal: Principal,
    challenge: string,
    userCode: string,
  ): Promise<DeviceApproved>;
}

export interface DeviceApprovalBound {
  readonly refusalsMax: number;
  readonly windowMs: number;
  readonly principalsMax: number;
}

export const deviceApprovalBoundDefault: DeviceApprovalBound = {
  refusalsMax: 5,
  windowMs: 5 * 60_000,
  principalsMax: 4_096,
};

/** One place in a person's count: a refusal, or a call the issuer has not answered yet. */
interface DeviceApprovalPlace {
  readonly atMs: number;
}

/** The per-person counts, read and written on the clock the caller hands each call. */
export interface DeviceApprovalGuesses {
  /** A place taken in `principal`'s count, or how long until one frees where the count is full. */
  take(
    principal: Principal,
    nowMs: number,
  ):
    | { readonly taken: "Taken"; readonly release: () => void }
    | { readonly taken: "Spent"; readonly retryAfterMs: number };
  /** How many people the map holds a count for. */
  held(): number;
}

function deviceApprovalBoundChecked(bound: DeviceApprovalBound): void {
  for (const [name, value] of Object.entries(bound))
    if (!Number.isSafeInteger(value) || (value as number) <= 0)
      throw new RangeError(
        `device approval ${name} must be a positive safe integer`,
      );
}

export function deviceApprovalGuesses(
  bound: DeviceApprovalBound = deviceApprovalBoundDefault,
): DeviceApprovalGuesses {
  deviceApprovalBoundChecked(bound);
  const counts = new Map<Principal, DeviceApprovalPlace[]>();
  const live = (principal: Principal, nowMs: number): DeviceApprovalPlace[] =>
    (counts.get(principal) ?? []).filter(
      (place) => place.atMs + bound.windowMs > nowMs,
    );
  return {
    take: (principal, nowMs) => {
      const places = live(principal, nowMs);
      if (places.length >= bound.refusalsMax) {
        counts.set(principal, places);
        const oldest = Math.min(...places.map((place) => place.atMs));
        return {
          taken: "Spent",
          retryAfterMs: oldest + bound.windowMs - nowMs,
        };
      }
      const place: DeviceApprovalPlace = { atMs: nowMs };
      counts.delete(principal);
      counts.set(principal, [...places, place]);
      for (const evicted of counts.keys()) {
        if (counts.size <= bound.principalsMax) break;
        counts.delete(evicted);
      }
      return {
        taken: "Taken",
        release: () => {
          const held = counts.get(principal);
          if (held === undefined) return;
          const kept = held.filter((other) => other !== place);
          if (kept.length === 0) counts.delete(principal);
          else counts.set(principal, kept);
        },
      };
    },
    held: () => counts.size,
  };
}

export function deviceApprovals(
  ports: { readonly codes: DeviceUserCodes; readonly nowMs: () => number },
  bound: DeviceApprovalBound = deviceApprovalBoundDefault,
): DeviceApprovals {
  const guesses = deviceApprovalGuesses(bound);
  return {
    approve: async (principal, challenge, userCode) => {
      const taken = guesses.take(principal, ports.nowMs());
      if (taken.taken === "Spent")
        return {
          answer: "TriesSpent",
          retryAfterSecs: Math.max(1, Math.ceil(taken.retryAfterMs / 1_000)),
        };
      let answered: DeviceUserCodeAnswer | undefined;
      try {
        answered = await ports.codes.accept(challenge, userCode);
        return answered;
      } finally {
        if (answered?.answer !== "CodeRefused") taken.release();
      }
    },
  };
}
