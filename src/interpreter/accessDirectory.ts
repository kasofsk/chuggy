/**
 * The directory of accounts people sign in as, as much of it as the access
 * plane asks: who holds a GitHub account or an email, creating an account, and
 * who a page of subjects are.
 *
 * A SUBJECT IS AN ACCOUNT ONLY IN A UUID'S SHAPE. The directory names every
 * account by one and refuses a whole question naming anything else, so a
 * subject of another shape is never sent and is answered as no account.
 *
 * AN OUTAGE IS THROWN AS `AccessDirectoryUnavailable` and never returned, for
 * `ProjectAccessUnavailable`'s reason: a directory that could not answer is not
 * one that said nobody holds the address.
 */

import {
  checkedProjectAccessTimeoutMs,
  checkedProjectAccessUrl,
} from "./projectAccess.ts";

/** An account as the plane reads it, each text kept only where it is in the shape the plane admits. */
export interface AccessAccount {
  readonly subject: string;
  readonly email?: string | undefined;
  readonly githubLogin?: string | undefined;
}

/** The GitHub account an invitation resolved, as GitHub spells it. */
export interface AccessGithubAccount {
  readonly id: string;
  readonly login: string;
}

/** What a created account carries, and what its admin metadata records. */
export interface AccessAccountCreation {
  readonly email: string;
  readonly github: AccessGithubAccount;
  readonly invitedBy: string;
  readonly tenant: string;
}

/** What a creation came to: the new subject, an account already holding the email or the credential, or an email the directory will not hold. */
export type AccessAccountCreated =
  | { readonly created: "Created"; readonly subject: string }
  | { readonly created: "Conflict" }
  | { readonly created: "EmailRefused" };

export interface AccessDirectory {
  /** The subject of the account carrying this GitHub account's credential, if one does. */
  githubHolder(github: AccessGithubAccount): Promise<string | undefined>;
  /** Whether some account holds this email, in any letter case. */
  emailHeld(email: string): Promise<boolean>;
  create(account: AccessAccountCreation): Promise<AccessAccountCreated>;
  /** The accounts among `subjects`, each in a UUID's shape and at most `accessDirectorySubjectsMax`, in one question. */
  accounts(subjects: readonly string[]): Promise<readonly AccessAccount[]>;
}

/** The most subjects one people list asks the directory about. */
export const accessDirectorySubjectsMax = 128;

const accessDirectoryUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Whether a subject is in the shape the directory names an account by. */
export function accessDirectorySubject(subject: string): boolean {
  return accessDirectoryUuidPattern.test(subject);
}

/** A fault that left a question of the directory undecided. */
export class AccessDirectoryUnavailable extends Error {
  constructor(why: string) {
    super(`access directory: ${why}`);
    this.name = "AccessDirectoryUnavailable";
  }
}

/** Where the directory's admin API is and how long one question may take. */
export interface AccessDirectorySettings {
  readonly adminUrl: string;
  readonly requestTimeoutMs: number;
}

/** Narrows the directory's settings, refusing an address no adapter could act on. */
export function checkedAccessDirectorySettings(input: {
  readonly adminUrl: string;
  readonly requestTimeoutMs?: number | undefined;
}): AccessDirectorySettings {
  return {
    adminUrl: checkedProjectAccessUrl(input.adminUrl, "directory admin URL"),
    requestTimeoutMs: checkedProjectAccessTimeoutMs(
      input.requestTimeoutMs,
      "directory timeout",
    ),
  };
}
