/**
 * Invite links: a tenant's grant made in advance, to whoever presents the
 * token signed in, once.
 *
 * A LINK IS ITS MAKER'S GRANT. Making one asks what an invitation asks, in the
 * same order and with the same answers, and what the maker could grant then is
 * what the link gives. Redeeming asks the maker nothing again: the caller
 * holding the token is granted what it carries, whatever kind they hold.
 *
 * ONE CLOCK DECIDES, THE STORE'S. Whether a link is open, used, revoked or
 * expired is answered by the store in the statement that reads or spends it,
 * so nothing here reads a clock or derives a state.
 *
 * A SPEND IS GIVEN BACK WHERE THE GRANT FAULTS. The grants are written as one
 * request, all or none, so a link given back is open again and nothing was
 * granted; the fault is then raised as the authority's outage is everywhere.
 *
 * THE TOKEN IS DRAWN AND DIGESTED BY WHAT COMPOSES THE PLANE, and only the
 * digest reaches the store. The mint's answer is the only one carrying it.
 */

import type {
  AccessInvitationGrants,
  AccessInviteLink,
  AccessInviteLinkMinted,
  AccessInviteLinkRedeemed,
  AccessInviteLinks,
  AccessTenantRole,
} from "../contract/accessPlane.ts";
import type { AccessDirectory } from "./accessDirectory.ts";
import {
  accessInvitationAdmitted,
  accessInvitationGrantable,
  accessInvitationGrants,
} from "./accessInvitation.ts";
import {
  accessAccountsNamed,
  accessTenantListed,
  type AccessTupleReader,
} from "./accessPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { ProjectGrantWriter } from "./projectGrant.ts";
import type { TenantId } from "./projectStore.ts";

/** What a link grants, as the store keeps it: the tenant role and each project's roles. */
export interface AccessInviteLinkGrants {
  readonly role: AccessTenantRole;
  readonly projects: NonNullable<AccessInvitationGrants["projects"]>;
}

/** One link as the store answers it, `mintedBy` and `usedBy` each a subject. */
export type AccessInviteLinkStored = AccessInviteLinkGrants & {
  readonly link: string;
  readonly newAccounts: boolean;
  readonly mintedBy: string;
  readonly mintedAtMs: number;
  readonly expiresAtMs: number;
} & (
    | { readonly state: "Open" | "Revoked" | "Expired" }
    | {
        readonly state: "Used";
        readonly usedBy: string;
        readonly usedAtMs: number;
      }
  );

/** What one mint writes. */
export interface AccessInviteLinkMint extends AccessInviteLinkGrants {
  readonly tenant: TenantId;
  readonly digest: string;
  readonly newAccounts: boolean;
  readonly mintedBy: string;
}

/** What one mint came to: the link and when it expires, or nothing because the tenant holds as many open links as it may. */
export type AccessInviteLinkWritten =
  | {
      readonly written: "Minted";
      readonly link: string;
      readonly expiresAtMs: number;
    }
  | { readonly written: "LimitReached" };

/** A link spent: whose tenant it is and what it grants. */
export interface AccessInviteLinkSpent extends AccessInviteLinkGrants {
  readonly link: string;
  readonly tenant: TenantId;
}

/**
 * The durable side of a link's whole life. `mint` writes under the tenant's
 * bound and drops its ended links past the number kept, `spend` is the single
 * write taking an open link for `subject`, `revoke` the single write ending an
 * open one, and `restore` gives back a spent one.
 */
export interface AccessInviteLinkStore {
  mint(link: AccessInviteLinkMint): Promise<AccessInviteLinkWritten>;
  listed(tenant: TenantId): Promise<readonly AccessInviteLinkStored[]>;
  held(
    tenant: TenantId,
    link: string,
  ): Promise<(AccessInviteLinkGrants & { readonly open: boolean }) | undefined>;
  revoke(tenant: TenantId, link: string): Promise<boolean>;
  spend(
    digest: string,
    subject: string,
  ): Promise<AccessInviteLinkSpent | undefined>;
  restore(link: string): Promise<boolean>;
}

/** How a token is drawn and digested, both supplied. */
export interface AccessInviteLinkSecrets {
  readonly draw: () => string;
  readonly digest: (token: string) => string;
}

export interface AccessInviteLinkPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
  readonly directory?: AccessDirectory | undefined;
  readonly links?:
    | {
        readonly store: AccessInviteLinkStore;
        readonly secrets: AccessInviteLinkSecrets;
      }
    | undefined;
}

export interface AccessInviteLinkSettings {
  readonly issuer: string;
}

/** The refusals every route shares: a plane with no store, and a caller or a link the plane answers as absent. */
export interface AccessInviteLinkRefusal {
  readonly outcome: "NotConfigured" | "Absent";
}

export type AccessInviteLinkMintResult =
  | { readonly outcome: "Minted"; readonly minted: AccessInviteLinkMinted }
  | AccessInviteLinkRefusal
  | { readonly outcome: "ProjectUnknown" | "Refused" | "LimitReached" };

export type AccessInviteLinksResult =
  | { readonly outcome: "Listed"; readonly listed: AccessInviteLinks }
  | AccessInviteLinkRefusal;

export type AccessInviteLinkRevocation =
  | AccessInviteLinkRefusal
  | { readonly outcome: "Revoked" | "Refused" | "Ended" };

export type AccessInviteLinkRedemption =
  | {
      readonly outcome: "Redeemed";
      readonly redeemed: AccessInviteLinkRedeemed;
    }
  | AccessInviteLinkRefusal;

export interface AccessInviteLinkService {
  mint(
    caller: Principal,
    tenant: TenantId,
    grants: AccessInvitationGrants,
  ): Promise<AccessInviteLinkMintResult>;
  listed(caller: Principal, tenant: TenantId): Promise<AccessInviteLinksResult>;
  revoked(
    caller: Principal,
    tenant: TenantId,
    link: string,
  ): Promise<AccessInviteLinkRevocation>;
  redeemed(
    caller: Principal,
    token: string,
  ): Promise<AccessInviteLinkRedemption>;
}

/** The caller's subject under the plane's issuer, which every authenticated caller of the plane has. */
function accessInviteLinkSubject(issuer: string, caller: Principal): string {
  const subject = oidcPrincipalSubject(issuer, caller);
  if (subject === undefined)
    throw new RangeError(
      "access invite link: the caller is not a subject of the plane's issuer",
    );
  return subject;
}

type AccessInviteLinkKept = NonNullable<AccessInviteLinkPorts["links"]>;

async function accessInviteLinkMinted(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
  request: {
    readonly caller: Principal;
    readonly tenant: TenantId;
    readonly grants: AccessInvitationGrants;
  },
): Promise<AccessInviteLinkMintResult> {
  const { caller, tenant, grants } = request;
  const refused = await accessInvitationAdmitted(ports, caller, tenant, grants);
  if (refused !== undefined) return { outcome: refused.invited };
  const newAccounts =
    (await ports.access.authorizeSite(caller, "CreateAccount")) !== undefined;
  const token = links.secrets.draw();
  const written = await links.store.mint({
    tenant,
    digest: links.secrets.digest(token),
    role: grants.role,
    projects: grants.projects ?? [],
    newAccounts,
    mintedBy: accessInviteLinkSubject(settings.issuer, caller),
  });
  if (written.written === "LimitReached") return { outcome: "LimitReached" };
  return {
    outcome: "Minted",
    minted: {
      link: written.link,
      token,
      expiresAtMs: written.expiresAtMs,
      newAccounts,
    },
  };
}

/** Every link the tenant keeps, each subject in it named by the directory in one question. */
async function accessInviteLinksNamed(
  directory: AccessDirectory | undefined,
  stored: readonly AccessInviteLinkStored[],
): Promise<AccessInviteLinks> {
  const subjects = new Set(
    stored.flatMap((link) =>
      link.state === "Used" ? [link.mintedBy, link.usedBy] : [link.mintedBy],
    ),
  );
  const named = new Map(
    (
      await accessAccountsNamed(
        directory,
        [...subjects].map((subject) => ({ subject })),
      )
    ).map((person) => [person.subject, person] as const),
  );
  const person = (subject: string) => named.get(subject) ?? { subject };
  return {
    links: stored.map((link): AccessInviteLink => {
      const kept = {
        link: link.link,
        role: link.role,
        projects: [...link.projects],
        newAccounts: link.newAccounts,
        mintedBy: person(link.mintedBy),
        mintedAtMs: link.mintedAtMs,
        expiresAtMs: link.expiresAtMs,
      };
      return link.state === "Used"
        ? {
            ...kept,
            state: link.state,
            usedBy: person(link.usedBy),
            usedAtMs: link.usedAtMs,
          }
        : { ...kept, state: link.state };
    }),
  };
}

async function accessInviteLinkRevoked(
  ports: AccessInviteLinkPorts,
  store: AccessInviteLinkStore,
  request: {
    readonly caller: Principal;
    readonly tenant: TenantId;
    readonly link: string;
  },
): Promise<AccessInviteLinkRevocation> {
  const { caller, tenant, link } = request;
  if (!(await accessTenantListed(ports.access, caller, tenant)))
    return { outcome: "Absent" };
  const held = await store.held(tenant, link);
  if (held === undefined) return { outcome: "Absent" };
  if (!(await accessInvitationGrantable(ports.access, caller, tenant, held)))
    return { outcome: "Refused" };
  if (!held.open) return { outcome: "Ended" };
  return (await store.revoke(tenant, link))
    ? { outcome: "Revoked" }
    : { outcome: "Ended" };
}

async function accessInviteLinkRedeemed(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
  request: { readonly caller: Principal; readonly token: string },
): Promise<AccessInviteLinkRedemption> {
  const subject = accessInviteLinkSubject(settings.issuer, request.caller);
  const spent = await links.store.spend(
    links.secrets.digest(request.token),
    subject,
  );
  if (spent === undefined) return { outcome: "Absent" };
  try {
    await ports.grants.writeAll(
      accessInvitationGrants(settings.issuer, spent.tenant, spent, subject),
    );
  } catch (failure) {
    await links.store.restore(spent.link);
    throw failure;
  }
  return {
    outcome: "Redeemed",
    redeemed: {
      tenant: spent.tenant,
      role: spent.role,
      projects: [...spent.projects],
    },
  };
}

export function accessInviteLinks(
  ports: AccessInviteLinkPorts,
  settings: AccessInviteLinkSettings,
): AccessInviteLinkService {
  const { links } = ports;
  if (links === undefined) {
    const notConfigured = () =>
      Promise.resolve({ outcome: "NotConfigured" } as const);
    return {
      mint: notConfigured,
      listed: notConfigured,
      revoked: notConfigured,
      redeemed: notConfigured,
    };
  }
  return {
    mint: (caller, tenant, grants) =>
      accessInviteLinkMinted(ports, links, settings, {
        caller,
        tenant,
        grants,
      }),
    listed: async (caller, tenant) => {
      if (!(await accessTenantListed(ports.access, caller, tenant)))
        return { outcome: "Absent" };
      return {
        outcome: "Listed",
        listed: await accessInviteLinksNamed(
          ports.directory,
          await links.store.listed(tenant),
        ),
      };
    },
    revoked: (caller, tenant, link) =>
      accessInviteLinkRevoked(ports, links.store, { caller, tenant, link }),
    redeemed: (caller, token) =>
      accessInviteLinkRedeemed(ports, links, settings, { caller, token }),
  };
}
