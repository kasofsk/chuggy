/**
 * A tenant's invite links and the site's workspace links held in memory, for
 * the links' suites and the server's, and the secrets a mint draws.
 *
 * A LINK'S STATE IS DERIVED AS THE STORE'S STATEMENTS DERIVE IT, against a
 * clock a case moves, and a mint keeps the tenant's bounds, or the site's, as
 * the store's does. A workspace link is a row naming no tenant, and no two
 * used links hold one workspace. Whether the database's own clock and lock answer the same is
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
  type AccessInviteLinkGrants,
  type AccessInviteLinkPorts,
  type AccessInviteLinkService,
  type AccessInviteLinkStore,
  type AccessInviteLinkStored,
  type AccessInviteLinkWritten,
  type AccessWorkspaceLinkStored,
} from "../../src/interpreter/accessInviteLink.ts";
import type { TenantId } from "../../src/interpreter/projectStore.ts";
import { accessMemoryClaims } from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

/** What every link keeps, whatever its kind. */
interface InviteLinkKept {
  readonly link: string;
  readonly digest: string;
  readonly newAccounts: boolean;
  readonly mintedBy: string;
  readonly mintedAtMs: number;
  expiresAtMs: number;
  used?:
    | {
        readonly by: string;
        readonly atMs: number;
        readonly workspace?: TenantId | undefined;
      }
    | undefined;
  revokedAtMs?: number | undefined;
}

/** A tenant's link as the memory keeps it. */
export interface InviteLinkTenantRow
  extends InviteLinkKept, AccessInviteLinkGrants {
  readonly tenant: TenantId;
}

/** A workspace link as the memory keeps it, naming no tenant. */
export interface InviteLinkWorkspaceRow extends InviteLinkKept {
  readonly tenant?: undefined;
  readonly createAccounts: boolean;
  readonly note: string | undefined;
}

/** One link as the memory keeps it. */
export type InviteLinkRow = InviteLinkTenantRow | InviteLinkWorkspaceRow;

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
  row: InviteLinkTenantRow,
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

function workspaceLinkStored(
  memory: InviteLinkMemory,
  row: InviteLinkWorkspaceRow,
): AccessWorkspaceLinkStored {
  const kept = {
    link: row.link,
    createAccounts: row.createAccounts,
    note: row.note,
    newAccounts: row.newAccounts,
    mintedBy: row.mintedBy,
    mintedAtMs: row.mintedAtMs,
    expiresAtMs: row.expiresAtMs,
  };
  if (row.used?.workspace !== undefined)
    return {
      ...kept,
      state: "Used",
      usedBy: row.used.by,
      usedAtMs: row.used.atMs,
      workspace: row.used.workspace,
    };
  if (row.revokedAtMs !== undefined) return { ...kept, state: "Revoked" };
  return {
    ...kept,
    state: row.expiresAtMs <= memory.nowMs ? "Expired" : "Open",
  };
}

/** Writes `link` under the bound of the links sharing its tenant, or naming none, as the store's mint does. */
function inviteLinkMinted(
  memory: InviteLinkMemory,
  link:
    | Omit<InviteLinkTenantRow, "link" | "mintedAtMs" | "expiresAtMs">
    | Omit<InviteLinkWorkspaceRow, "link" | "mintedAtMs" | "expiresAtMs">,
): Promise<AccessInviteLinkWritten> {
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
  const row = {
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

/** The open link `digest` names, if any. */
function inviteLinkOpenNamed(
  memory: InviteLinkMemory,
  digest: string,
): InviteLinkRow | undefined {
  return memory.rows.find(
    (one) => one.digest === digest && inviteLinkOpen(memory, one),
  );
}

/** The tenant's links, newest first. */
function inviteLinksOf(
  memory: InviteLinkMemory,
  tenant: string,
): InviteLinkTenantRow[] {
  return memory.rows
    .filter((row): row is InviteLinkTenantRow => row.tenant === tenant)
    .sort((one, other) => other.mintedAtMs - one.mintedAtMs);
}

/** The site's workspace links, newest first. */
function workspaceLinksOf(memory: InviteLinkMemory): InviteLinkWorkspaceRow[] {
  return memory.rows
    .filter((row): row is InviteLinkWorkspaceRow => row.tenant === undefined)
    .sort((one, other) => other.mintedAtMs - one.mintedAtMs);
}

/** The site's workspace link statements over `memory`. */
function workspaceLinkStore(
  memory: InviteLinkMemory,
): Pick<
  AccessInviteLinkStore,
  | "workspaceMint"
  | "workspaceListed"
  | "workspaceHeld"
  | "workspaceRevoke"
  | "workspaceSpend"
> {
  const find = (link: string) =>
    workspaceLinksOf(memory).find((row) => row.link === link);
  return {
    workspaceMint: (link) => inviteLinkMinted(memory, link),
    workspaceListed: () =>
      Promise.resolve(
        workspaceLinksOf(memory).map((row) => workspaceLinkStored(memory, row)),
      ),
    workspaceHeld: (link) => {
      const row = find(link);
      return Promise.resolve(
        row === undefined
          ? undefined
          : {
              createAccounts: row.createAccounts,
              open: inviteLinkOpen(memory, row),
            },
      );
    },
    workspaceRevoke: (link) => {
      const row = find(link);
      if (row === undefined || !inviteLinkOpen(memory, row))
        return Promise.resolve(false);
      row.revokedAtMs = memory.nowMs;
      return Promise.resolve(true);
    },
    workspaceSpend: (digest, subject, workspace) => {
      const row = inviteLinkOpenNamed(memory, digest);
      if (row === undefined || row.tenant !== undefined)
        return Promise.resolve(undefined);
      if (memory.rows.some((one) => one.used?.workspace === workspace))
        return Promise.resolve({ spent: "Taken" } as const);
      row.used = { by: subject, atMs: memory.nowMs, workspace };
      return Promise.resolve({
        spent: "Spent",
        link: row.link,
        createAccounts: row.createAccounts,
      } as const);
    },
  };
}

function inviteLinkStore(memory: InviteLinkMemory): AccessInviteLinkStore {
  const find = (tenant: string, link: string) =>
    inviteLinksOf(memory, tenant).find((row) => row.link === link);
  return {
    mint: (link) => inviteLinkMinted(memory, link),
    listed: (tenant) =>
      Promise.resolve(
        inviteLinksOf(memory, tenant).map((row) =>
          inviteLinkStored(memory, row),
        ),
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
      const row = inviteLinkOpenNamed(memory, digest);
      if (row?.tenant === undefined) return Promise.resolve(undefined);
      row.used = { by: subject, atMs: memory.nowMs };
      return Promise.resolve({
        link: row.link,
        tenant: row.tenant,
        role: row.role,
        projects: row.projects,
      });
    },
    opened: (digest) => {
      const row = inviteLinkOpenNamed(memory, digest);
      return Promise.resolve(
        row === undefined ? undefined : { newAccounts: row.newAccounts },
      );
    },
    presented: (digest) => {
      const row = inviteLinkOpenNamed(memory, digest);
      if (row === undefined) return Promise.resolve(undefined);
      return Promise.resolve(row.tenant === undefined ? "Workspace" : "Tenant");
    },
    ...workspaceLinkStore(memory),
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

/** Invite links over the authority `memory` and the links `links` hold, with no store where `links` is undefined, and the grants and claims `ported` names in place of the authority's. */
export function accessMemoryInviteLinks(
  memory: AccessMemory,
  links: InviteLinkMemory | undefined,
  directory?: AccessDirectory,
  ported: Partial<Pick<AccessInviteLinkPorts, "grants" | "claims">> = {},
): AccessInviteLinkService {
  return accessInviteLinks(
    {
      access: memory.access,
      tuples: memory.reader,
      grants: ported.grants ?? memory.grants,
      claims: ported.claims ?? accessMemoryClaims(memory),
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
