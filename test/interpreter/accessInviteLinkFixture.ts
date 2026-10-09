/**
 * A tenant's invite links held in memory, for the links' suites and the
 * server's, and the secrets a mint draws.
 *
 * A LINK'S STATE IS DERIVED AS THE STORE'S STATEMENTS DERIVE IT, against a
 * clock a case moves, and a mint keeps the tenant's bounds as the store's
 * does. Whether the database's own clock and lock answer the same is
 * `test/postgres/inviteLinks.test.ts`'s to show.
 */

import {
  accessInviteLinkLifetimeMs,
  accessInviteLinksEndedKept,
  accessInviteLinksOpenMax,
} from "../../src/contract/accessPlane.ts";
import type { AccessDirectory } from "../../src/interpreter/accessDirectory.ts";
import {
  accessInviteLinks,
  type AccessInviteLinkMint,
  type AccessInviteLinkService,
  type AccessInviteLinkStore,
  type AccessInviteLinkStored,
} from "../../src/interpreter/accessInviteLink.ts";
import {
  accessFixtureIssuer,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

/** One link as the memory keeps it. */
export interface InviteLinkRow extends AccessInviteLinkMint {
  readonly link: string;
  readonly mintedAtMs: number;
  expiresAtMs: number;
  used?: { readonly by: string; readonly atMs: number } | undefined;
  revokedAtMs?: number | undefined;
}

export interface InviteLinkMemory {
  readonly rows: InviteLinkRow[];
  /** The clock every state is derived against, which each mint moves on by one. */
  nowMs: number;
  /** Every token drawn, in order. */
  readonly drawn: string[];
  readonly store: AccessInviteLinkStore;
}

/** When a link ended, or nothing while it is open. */
function inviteLinkEndedAtMs(
  memory: InviteLinkMemory,
  row: InviteLinkRow,
): number | undefined {
  if (row.used !== undefined) return row.used.atMs;
  if (row.revokedAtMs !== undefined) return row.revokedAtMs;
  return row.expiresAtMs <= memory.nowMs ? row.expiresAtMs : undefined;
}

function inviteLinkStored(
  memory: InviteLinkMemory,
  row: InviteLinkRow,
): AccessInviteLinkStored {
  const kept = {
    link: row.link,
    role: row.role,
    projects: row.projects,
    newAccounts: row.newAccounts,
    mintedBy: row.mintedBy,
    mintedAtMs: row.mintedAtMs,
    expiresAtMs: row.expiresAtMs,
  };
  if (row.used !== undefined)
    return {
      ...kept,
      state: "Used",
      usedBy: row.used.by,
      usedAtMs: row.used.atMs,
    };
  if (row.revokedAtMs !== undefined) return { ...kept, state: "Revoked" };
  return {
    ...kept,
    state: row.expiresAtMs <= memory.nowMs ? "Expired" : "Open",
  };
}

function inviteLinkMinted(
  memory: InviteLinkMemory,
  link: AccessInviteLinkMint,
) {
  memory.nowMs += 1;
  const ended = memory.rows
    .filter((row) => row.tenant === link.tenant)
    .flatMap((row) => {
      const at = inviteLinkEndedAtMs(memory, row);
      return at === undefined ? [] : [{ row, at }];
    })
    .sort((one, other) => other.at - one.at);
  for (const { row } of ended.slice(accessInviteLinksEndedKept))
    memory.rows.splice(memory.rows.indexOf(row), 1);
  const open = memory.rows.filter(
    (row) =>
      row.tenant === link.tenant &&
      inviteLinkEndedAtMs(memory, row) === undefined,
  ).length;
  if (open >= accessInviteLinksOpenMax)
    return Promise.resolve({ written: "LimitReached" } as const);
  const row: InviteLinkRow = {
    ...link,
    link: `link-${String(memory.drawn.length)}-${String(memory.nowMs)}`,
    mintedAtMs: memory.nowMs,
    expiresAtMs: memory.nowMs + accessInviteLinkLifetimeMs,
  };
  memory.rows.push(row);
  return Promise.resolve({
    written: "Minted",
    link: row.link,
    expiresAtMs: row.expiresAtMs,
  } as const);
}

function inviteLinkOpen(memory: InviteLinkMemory, row: InviteLinkRow): boolean {
  return inviteLinkEndedAtMs(memory, row) === undefined;
}

function inviteLinkStore(memory: InviteLinkMemory): AccessInviteLinkStore {
  const find = (tenant: string, link: string) =>
    memory.rows.find((row) => row.tenant === tenant && row.link === link);
  return {
    mint: (link) => inviteLinkMinted(memory, link),
    listed: (tenant) =>
      Promise.resolve(
        memory.rows
          .filter((row) => row.tenant === tenant)
          .sort((one, other) => other.mintedAtMs - one.mintedAtMs)
          .map((row) => inviteLinkStored(memory, row)),
      ),
    held: (tenant, link) => {
      const row = find(tenant, link);
      return Promise.resolve(
        row === undefined
          ? undefined
          : {
              role: row.role,
              projects: row.projects,
              open: inviteLinkOpen(memory, row),
            },
      );
    },
    revoke: (tenant, link) => {
      const row = find(tenant, link);
      if (row === undefined || !inviteLinkOpen(memory, row))
        return Promise.resolve(false);
      row.revokedAtMs = memory.nowMs;
      return Promise.resolve(true);
    },
    spend: (digest, subject) => {
      const row = memory.rows.find(
        (one) => one.digest === digest && inviteLinkOpen(memory, one),
      );
      if (row === undefined) return Promise.resolve(undefined);
      row.used = { by: subject, atMs: memory.nowMs };
      return Promise.resolve({
        link: row.link,
        tenant: row.tenant,
        role: row.role,
        projects: row.projects,
      });
    },
    restore: (link) => {
      const row = memory.rows.find((one) => one.link === link);
      if (row?.used === undefined) return Promise.resolve(false);
      row.used = undefined;
      return Promise.resolve(true);
    },
  };
}

/** No links, the clock at an hour past the epoch. */
export function inviteLinkMemory(): InviteLinkMemory {
  const memory: Omit<InviteLinkMemory, "store"> = {
    rows: [],
    nowMs: 3_600_000,
    drawn: [],
  };
  const full = memory as InviteLinkMemory;
  return Object.assign(full, { store: inviteLinkStore(full) });
}

/** The digest the fixture's secrets give `token`. */
export function inviteLinkDigest(token: string): string {
  return `digest:${token}`;
}

/** Invite links over the authority `memory` and the links `links` hold, with no store where `links` is undefined. */
export function accessMemoryInviteLinks(
  memory: AccessMemory,
  links: InviteLinkMemory | undefined,
  directory?: AccessDirectory,
): AccessInviteLinkService {
  return accessInviteLinks(
    {
      access: memory.access,
      tuples: memory.reader,
      grants: memory.grants,
      directory,
      links:
        links === undefined
          ? undefined
          : {
              store: links.store,
              secrets: {
                draw: () => {
                  const token = `token-${String(links.drawn.length)}`;
                  links.drawn.push(token);
                  return token;
                },
                digest: inviteLinkDigest,
              },
            },
    },
    { issuer: accessFixtureIssuer },
  );
}
