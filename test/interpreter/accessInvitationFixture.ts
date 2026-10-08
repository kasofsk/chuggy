/**
 * A directory and a GitHub held in memory for the invitation's and the lists'
 * suites, each recording what it was asked.
 *
 * THE DIRECTORY CONFLICTS AS KRATOS DOES: a creation whose email, in any
 * letter case, or whose GitHub credential another account holds is answered
 * as a conflict, and the two are not told apart.
 */

import {
  AccessDirectoryUnavailable,
  type AccessAccountCreation,
  type AccessDirectory,
} from "../../src/interpreter/accessDirectory.ts";
import {
  accessInvitations,
  type AccessGithubLookup,
  type AccessInvitations,
} from "../../src/interpreter/accessInvitation.ts";
import {
  accessFixtureIssuer,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

/** One account the directory holds. */
export interface DirectoryAccount {
  readonly subject: string;
  readonly email: string;
  readonly githubId?: string;
  readonly githubLogin?: string;
}

export interface DirectoryMemory {
  readonly accounts: DirectoryAccount[];
  /** Every question asked, as `verb:argument`, in order. */
  readonly asked: string[];
  readonly creations: AccessAccountCreation[];
  unavailable: boolean;
  /** What every creation answers in place of deciding, where set. */
  creationAnswer?: "Conflict" | "EmailRefused" | undefined;
  /** Runs before a creation is decided, as a request racing it would. */
  beforeCreation?: (() => void) | undefined;
  readonly directory: AccessDirectory;
}

/** The subject the directory gives its `index`th created account. */
export function directorySubject(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function directoryReachable(memory: DirectoryMemory): void {
  if (memory.unavailable)
    throw new AccessDirectoryUnavailable("the directory is not there");
}

function directoryCreate(
  memory: DirectoryMemory,
  account: AccessAccountCreation,
) {
  memory.beforeCreation?.();
  if (memory.creationAnswer !== undefined)
    return { created: memory.creationAnswer } as const;
  const held = memory.accounts.some(
    (one) =>
      one.email.toLowerCase() === account.email.toLowerCase() ||
      one.githubId === account.github.id,
  );
  if (held) return { created: "Conflict" } as const;
  const subject = directorySubject(memory.creations.length);
  memory.accounts.push({
    subject,
    email: account.email,
    githubId: account.github.id,
    githubLogin: account.github.login,
  });
  return { created: "Created", subject } as const;
}

export function directoryMemory(
  accounts: readonly DirectoryAccount[] = [],
): DirectoryMemory {
  const memory: Omit<DirectoryMemory, "directory"> = {
    accounts: [...accounts],
    asked: [],
    creations: [],
    unavailable: false,
  };
  const full = memory as DirectoryMemory;
  return Object.assign(full, {
    directory: {
      githubHolder: (github) => {
        memory.asked.push(`githubHolder:${github.id}`);
        directoryReachable(full);
        return Promise.resolve(
          memory.accounts.find((one) => one.githubId === github.id)?.subject,
        );
      },
      emailHeld: (email) => {
        memory.asked.push(`emailHeld:${email}`);
        directoryReachable(full);
        return Promise.resolve(
          memory.accounts.some(
            (one) => one.email.toLowerCase() === email.toLowerCase(),
          ),
        );
      },
      create: (account) => {
        memory.asked.push(`create:${account.email}`);
        directoryReachable(full);
        const created = directoryCreate(full, account);
        memory.creations.push(account);
        return Promise.resolve(created);
      },
      accounts: (subjects) => {
        memory.asked.push(`accounts:${subjects.join(",")}`);
        directoryReachable(full);
        return Promise.resolve(
          memory.accounts
            .filter((one) => subjects.includes(one.subject))
            .map((one) => ({
              subject: one.subject,
              email: one.email,
              githubLogin: one.githubLogin,
            })),
        );
      },
    } satisfies AccessDirectory,
  });
}

export interface GithubMemory {
  /** Every username looked up, in order. */
  readonly looked: string[];
  readonly lookup: (login: string) => Promise<AccessGithubLookup>;
}

/** A GitHub answering each username from `answers`, and any other as unknown. */
export function githubMemory(
  answers: Readonly<Record<string, AccessGithubLookup>>,
): GithubMemory {
  const looked: string[] = [];
  return {
    looked,
    lookup: (login) => {
      looked.push(login);
      return Promise.resolve(answers[login] ?? { looked: "Unknown" });
    },
  };
}

/** An account as GitHub answers it, a person's unless `kind` says otherwise. */
export function githubUser(
  id: string,
  login: string,
  kind = "User",
): AccessGithubLookup {
  return { looked: "Found", account: { id, login }, kind };
}

/** The invitations over `memory`, `directory` and `github`, either absent being a plane with no directory. */
export function accessMemoryInvitations(
  memory: AccessMemory,
  directory: DirectoryMemory | undefined,
  github: GithubMemory | undefined,
): AccessInvitations {
  return accessInvitations(
    {
      access: memory.access,
      tuples: memory.reader,
      grants: memory.grants,
      directory: directory?.directory,
      github,
    },
    { issuer: accessFixtureIssuer },
  );
}
