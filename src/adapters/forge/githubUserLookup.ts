/**
 * `AccessGithubAccounts` over GitHub's public user lookup: a username resolved
 * to the account's numeric id, its login as GitHub spells it, and its kind.
 *
 * IT PRESENTS NO CREDENTIAL. The lookup needs none, and the allowance GitHub
 * grants without one is counted by address, so a throttle is an outage like
 * any other and nothing is cached.
 *
 * ONLY A 404 IS AN UNKNOWN ACCOUNT. Every other refusal is an outage, and
 * nothing GitHub wrote in free text is kept: the kind is read as bounded text
 * because GitHub names more kinds than this tree admits, and the plane decides
 * which it takes.
 */

import { z } from "zod";

import { accessGithubLoginSchema } from "../../contract/accessPlane.ts";
import type {
  AccessGithubAccounts,
  AccessGithubLookup,
} from "../../interpreter/accessInvitation.ts";
import {
  githubAppRead,
  githubPublicSend,
  githubRequestBounds,
  type GithubRequestOptions,
} from "./githubAppRequest.ts";

/** The status a known account is answered with, and the one an unknown one is. */
const githubUserFoundStatus = 200;
const githubUserUnknownStatus = 404;

/** The longest account kind read, which is far past any GitHub names. */
const githubUserKindCharsMax = 64;

/** The fields of an account this side reads. */
const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: accessGithubLoginSchema,
  type: z.string().min(1).max(githubUserKindCharsMax),
});

export function githubUserLookup(
  options: GithubRequestOptions,
): AccessGithubAccounts {
  const bounds = githubRequestBounds(options);
  return {
    lookup: async (login): Promise<AccessGithubLookup> => {
      const answered = await githubPublicSend(bounds, {
        url: new URL(`/users/${encodeURIComponent(login)}`, bounds.apiUrl),
        method: "GET",
        okStatus: githubUserFoundStatus,
      });
      if (answered.answered === "Denied")
        return answered.evidence?.status === githubUserUnknownStatus
          ? { looked: "Unknown" }
          : { looked: "Unavailable" };
      if (answered.answered === "Unavailable") return { looked: "Unavailable" };
      const user = await githubAppRead(
        bounds,
        answered.response,
        githubUserSchema,
      );
      return user === undefined
        ? { looked: "Unavailable" }
        : {
            looked: "Found",
            account: { id: String(user.id), login: user.login },
            kind: user.type,
          };
    },
  };
}
