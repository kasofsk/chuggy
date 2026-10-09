/**
 * Invite links: a tenant's grant made in advance, to whoever presents the
 * token signed in, once; and the site's workspace links, its invitation made
 * in advance with the person and the workspace left blank.
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
 * A WORKSPACE LINK ASKS WHAT THE SITE'S INVITATION ASKS, to make, list or
 * revoke one, and using it writes what that invitation writes for whoever
 * presents it and the workspace they name. The two kinds never meet: a
 * tenant's routes reach its links alone, and the site's its workspace links.
 *
 * A REDEMPTION READS THE LINK BEFORE IT SPENDS IT, so a workspace link
 * presented with no name, a name no new tenant may take or one something
 * holds is answered and stays open. A free name is then carried in the spend,
 * where the store refuses one another link has made, so two links never make
 * one workspace.
 *
 * A SPEND IS GIVEN BACK WHERE THE GRANT FAULTS. The grants are written as one
 * request, all or none, so a link given back is open again and nothing was
 * granted; the fault is then raised as the authority's outage is everywhere.
 *
 * A USED LINK ANSWERS ITS USER AGAIN WHAT IT GAVE, and nothing is written, so
 * a person whose answer was lost and who sends again is told what they hold
 * from it, and one whose access was since removed is not given it back. Anyone
 * else is answered absent. Wherever a redemption finds no open link to take,
 * it asks the store for the used link the digest names whose user is the
 * caller, and the answer says what the link gave, never what is held now.
 *
 * A REGISTRATION IS ADMITTED BY READING A LINK, NEVER BY SPENDING IT. The
 * directory may ask twice about one registration, or fail it after admitting
 * it, and redeeming is still what spends the link.
 *
 * THE TOKEN IS DRAWN AND DIGESTED BY WHAT COMPOSES THE PLANE, and only the
 * digest reaches the store. The mint's answer is the only one carrying it.
 */

import {
  accessOwnedTenantSchema,
  type AccessInvitationGrants,
  type AccessInviteLink,
  type AccessInviteLinkMinted,
  type AccessInviteLinkRedeemed,
  type AccessInviteLinks,
  type AccessTenantRole,
  type AccessWorkspaceLink,
  type AccessWorkspaceLinkCreation,
  type AccessWorkspaceLinks,
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
import {
  accessOwnerInvitationAdmitted,
  accessOwnerInvitationGrants,
} from "./accessOwnerInvitation.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { TenantClaims } from "./projectCreation.ts";
import type { ProjectGrantWriter } from "./projectGrant.ts";
import { asTenantId, type TenantId } from "./projectStore.ts";

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

/** What one workspace link's mint writes. */
export interface AccessWorkspaceLinkMint {
  readonly digest: string;
  readonly createAccounts: boolean;
  readonly note: string | undefined;
  readonly newAccounts: boolean;
  readonly mintedBy: string;
}

/** One workspace link as the store answers it, a `Used` one naming the workspace its use made. */
export type AccessWorkspaceLinkStored = {
  readonly link: string;
  readonly createAccounts: boolean;
  readonly note: string | undefined;
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
      readonly workspace: TenantId;
    }
);

/** What a workspace link's spend came to where its link was open: spent, or refused because another link made the workspace it names. */
export type AccessWorkspaceLinkSpent =
  | {
      readonly spent: "Spent";
      readonly link: string;
      readonly createAccounts: boolean;
    }
  | { readonly spent: "Taken" };

/** What one mint came to: the link and when it expires, or nothing because the tenant, or the site, holds as many open links as it may. */
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
 * write taking an open tenant's link for `subject`, `revoke` the single write
 * ending an open one, `restore` gives back a spent link of either kind, and
 * `opened` and `presented` each read the open link a digest names without
 * spending it, `usedBy` reads the used link of either kind a digest names
 * whose user is `subject`, whatever the clock says; each `workspace` statement
 * is its tenant counterpart over the site's workspace links alone,
 * `workspaceSpend` also writing the workspace and refusing one another used
 * link holds.
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
  opened(
    digest: string,
  ): Promise<{ readonly newAccounts: boolean } | undefined>;
  presented(digest: string): Promise<"Tenant" | "Workspace" | undefined>;
  usedBy(
    digest: string,
    subject: string,
  ): Promise<AccessInviteLinkUsed | undefined>;
  workspaceMint(
    link: AccessWorkspaceLinkMint,
  ): Promise<AccessInviteLinkWritten>;
  workspaceListed(): Promise<readonly AccessWorkspaceLinkStored[]>;
  workspaceHeld(
    link: string,
  ): Promise<
    { readonly createAccounts: boolean; readonly open: boolean } | undefined
  >;
  workspaceRevoke(link: string): Promise<boolean>;
  workspaceSpend(
    digest: string,
    subject: string,
    workspace: TenantId,
  ): Promise<AccessWorkspaceLinkSpent | undefined>;
}

/** A used link as its user is answered it again: a tenant's with what it grants, a workspace link with the workspace its use made. */
export type AccessInviteLinkUsed =
  | ({
      readonly kind: "Tenant";
      readonly tenant: TenantId;
    } & AccessInviteLinkGrants)
  | { readonly kind: "Workspace"; readonly workspace: TenantId };

/** How a token is drawn and digested, both supplied. */
export interface AccessInviteLinkSecrets {
  readonly draw: () => string;
  readonly digest: (token: string) => string;
}

export interface AccessInviteLinkPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
  readonly claims: TenantClaims;
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

export type AccessWorkspaceLinkMintResult =
  | { readonly outcome: "Minted"; readonly minted: AccessInviteLinkMinted }
  | AccessInviteLinkRefusal
  | { readonly outcome: "Refused" | "LimitReached" };

export type AccessWorkspaceLinksResult =
  | { readonly outcome: "Listed"; readonly listed: AccessWorkspaceLinks }
  | AccessInviteLinkRefusal;

export type AccessInviteLinkRevocation =
  | AccessInviteLinkRefusal
  | { readonly outcome: "Revoked" | "Refused" | "Ended" };

export type AccessInviteLinkRedemption =
  | {
      readonly outcome: "Redeemed";
      readonly redeemed: AccessInviteLinkRedeemed;
    }
  | AccessInviteLinkRefusal
  | { readonly outcome: "NameWanted" | "TenantTaken" };

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
  workspaceMint(
    caller: Principal,
    creation: AccessWorkspaceLinkCreation,
  ): Promise<AccessWorkspaceLinkMintResult>;
  workspaceListed(caller: Principal): Promise<AccessWorkspaceLinksResult>;
  workspaceRevoked(
    caller: Principal,
    link: string,
  ): Promise<AccessInviteLinkRevocation>;
  /** Uses the link `token` names, `workspace` the name a workspace link's new workspace takes and ignored for a tenant's link. */
  redeemed(
    caller: Principal,
    token: string,
    workspace?: string,
  ): Promise<AccessInviteLinkRedemption>;
  /** Whether a person with no account may register holding `token`: only while it is an open link whose maker could make accounts. */
  registrationAdmitted(token: string | undefined): Promise<boolean>;
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

/** What a mint answers once the store has written it or refused it at its bound. */
function accessInviteLinkMintAnswer(
  written: AccessInviteLinkWritten,
  token: string,
  newAccounts: boolean,
):
  | { readonly outcome: "Minted"; readonly minted: AccessInviteLinkMinted }
  | { readonly outcome: "LimitReached" } {
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
  return accessInviteLinkMintAnswer(written, token, newAccounts);
}

async function accessWorkspaceLinkMinted(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
  request: {
    readonly caller: Principal;
    readonly creation: AccessWorkspaceLinkCreation;
  },
): Promise<AccessWorkspaceLinkMintResult> {
  const { caller, creation } = request;
  const refused = await accessOwnerInvitationAdmitted(
    ports.access,
    caller,
    creation,
  );
  if (refused !== undefined) return { outcome: refused.invited };
  const newAccounts =
    (await ports.access.authorizeSite(caller, "CreateAccount")) !== undefined;
  const token = links.secrets.draw();
  const written = await links.store.workspaceMint({
    digest: links.secrets.digest(token),
    createAccounts: creation.createAccounts,
    note: creation.note,
    newAccounts,
    mintedBy: accessInviteLinkSubject(settings.issuer, caller),
  });
  return accessInviteLinkMintAnswer(written, token, newAccounts);
}

/** Each of `subjects` named by the directory in one question, a subject it does not name answered alone. */
async function accessInviteLinkPeople(
  directory: AccessDirectory | undefined,
  subjects: readonly string[],
): Promise<(subject: string) => AccessInviteLink["mintedBy"]> {
  const named = new Map(
    (
      await accessAccountsNamed(
        directory,
        [...new Set(subjects)].map((subject) => ({ subject })),
      )
    ).map((person) => [person.subject, person] as const),
  );
  return (subject) => named.get(subject) ?? { subject };
}

/** Every link the tenant keeps, each subject in it named by the directory in one question. */
async function accessInviteLinksNamed(
  directory: AccessDirectory | undefined,
  stored: readonly AccessInviteLinkStored[],
): Promise<AccessInviteLinks> {
  const person = await accessInviteLinkPeople(
    directory,
    stored.flatMap((link) =>
      link.state === "Used" ? [link.mintedBy, link.usedBy] : [link.mintedBy],
    ),
  );
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

/** Every workspace link the site keeps, each subject in it named by the directory in one question. */
async function accessWorkspaceLinksNamed(
  directory: AccessDirectory | undefined,
  stored: readonly AccessWorkspaceLinkStored[],
): Promise<AccessWorkspaceLinks> {
  const person = await accessInviteLinkPeople(
    directory,
    stored.flatMap((link) =>
      link.state === "Used" ? [link.mintedBy, link.usedBy] : [link.mintedBy],
    ),
  );
  return {
    links: stored.map((link): AccessWorkspaceLink => {
      const kept = {
        link: link.link,
        ...(link.note === undefined ? {} : { note: link.note }),
        createAccounts: link.createAccounts,
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
            workspace: link.workspace,
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

/** Revoking a workspace link, which asks what making it asked: `CreateTenant`, and `ManageSiteAuthorities` where it carries `createAccounts`. */
async function accessWorkspaceLinkRevoked(
  access: ProjectAccess,
  store: AccessInviteLinkStore,
  request: { readonly caller: Principal; readonly link: string },
): Promise<AccessInviteLinkRevocation> {
  const { caller, link } = request;
  if ((await access.authorizeSite(caller, "CreateTenant")) === undefined)
    return { outcome: "Absent" };
  const held = await store.workspaceHeld(link);
  if (held === undefined) return { outcome: "Absent" };
  if (
    held.createAccounts &&
    (await access.authorizeSite(caller, "ManageSiteAuthorities")) === undefined
  )
    return { outcome: "Refused" };
  if (!held.open) return { outcome: "Ended" };
  return (await store.workspaceRevoke(link))
    ? { outcome: "Revoked" }
    : { outcome: "Ended" };
}

/**
 * Writes a spent link's grants as one request, giving the link back and
 * raising where that faults. Until the give-back the link reads as used by its
 * caller, who is answered as though this send had worked, and where the
 * give-back never happens that stays so with nothing granted for as long as
 * the row is kept.
 */
async function accessInviteLinkGrantsWritten(
  ports: AccessInviteLinkPorts,
  store: AccessInviteLinkStore,
  link: string,
  grants: Parameters<ProjectGrantWriter["writeAll"]>[0],
): Promise<void> {
  try {
    await ports.grants.writeAll(grants);
  } catch (failure) {
    await store.restore(link);
    throw failure;
  }
}

/** What a redemption that found no open link to take answers: what the link gave, where the caller used it, and absent otherwise. */
async function accessInviteLinkUsedAnswer(
  store: AccessInviteLinkStore,
  digest: string,
  subject: string,
): Promise<AccessInviteLinkRedemption> {
  const used = await store.usedBy(digest, subject);
  if (used === undefined) return { outcome: "Absent" };
  switch (used.kind) {
    case "Tenant":
      return {
        outcome: "Redeemed",
        redeemed: {
          tenant: used.tenant,
          role: used.role,
          projects: [...used.projects],
        },
      };
    case "Workspace":
      return {
        outcome: "Redeemed",
        redeemed: { tenant: used.workspace, role: "Admin", projects: [] },
      };
  }
}

/** Using an open workspace link: the name wanted, admissible and free before the spend that carries it, and the site's invitation's grants after. A send overlapping its caller's own first with the same name can find the name taken by the first's grants. */
async function accessWorkspaceLinkRedeemed(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
  request: {
    readonly subject: string;
    readonly digest: string;
    readonly workspace: string | undefined;
  },
): Promise<AccessInviteLinkRedemption> {
  const { subject, digest, workspace } = request;
  if (workspace === undefined) return { outcome: "NameWanted" };
  if (!accessOwnedTenantSchema.safeParse(workspace).success)
    throw new RangeError(
      "access workspace link: the workspace is not a name a new tenant may take",
    );
  const tenant = asTenantId(workspace);
  if (await ports.claims.claimed(tenant)) return { outcome: "TenantTaken" };
  const spent = await links.store.workspaceSpend(digest, subject, tenant);
  if (spent === undefined)
    return accessInviteLinkUsedAnswer(links.store, digest, subject);
  if (spent.spent === "Taken") return { outcome: "TenantTaken" };
  await accessInviteLinkGrantsWritten(
    ports,
    links.store,
    spent.link,
    accessOwnerInvitationGrants(
      settings.issuer,
      tenant,
      subject,
      spent.createAccounts,
    ),
  );
  return {
    outcome: "Redeemed",
    redeemed: { tenant, role: "Admin", projects: [] },
  };
}

async function accessInviteLinkRedeemed(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
  request: {
    readonly caller: Principal;
    readonly token: string;
    readonly workspace: string | undefined;
  },
): Promise<AccessInviteLinkRedemption> {
  const subject = accessInviteLinkSubject(settings.issuer, request.caller);
  const digest = links.secrets.digest(request.token);
  const presented = await links.store.presented(digest);
  if (presented === undefined)
    return accessInviteLinkUsedAnswer(links.store, digest, subject);
  if (presented === "Workspace")
    return accessWorkspaceLinkRedeemed(ports, links, settings, {
      subject,
      digest,
      workspace: request.workspace,
    });
  const spent = await links.store.spend(digest, subject);
  if (spent === undefined)
    return accessInviteLinkUsedAnswer(links.store, digest, subject);
  await accessInviteLinkGrantsWritten(
    ports,
    links.store,
    spent.link,
    accessInvitationGrants(settings.issuer, spent.tenant, spent, subject),
  );
  return {
    outcome: "Redeemed",
    redeemed: {
      tenant: spent.tenant,
      role: spent.role,
      projects: [...spent.projects],
    },
  };
}

/** The site's workspace link routes over a store. */
function accessWorkspaceLinkRoutes(
  ports: AccessInviteLinkPorts,
  links: AccessInviteLinkKept,
  settings: AccessInviteLinkSettings,
): Pick<
  AccessInviteLinkService,
  "workspaceMint" | "workspaceListed" | "workspaceRevoked"
> {
  return {
    workspaceMint: (caller, creation) =>
      accessWorkspaceLinkMinted(ports, links, settings, { caller, creation }),
    workspaceListed: async (caller) => {
      if (
        (await ports.access.authorizeSite(caller, "CreateTenant")) === undefined
      )
        return { outcome: "Absent" };
      return {
        outcome: "Listed",
        listed: await accessWorkspaceLinksNamed(
          ports.directory,
          await links.store.workspaceListed(),
        ),
      };
    },
    workspaceRevoked: (caller, link) =>
      accessWorkspaceLinkRevoked(ports.access, links.store, { caller, link }),
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
      workspaceMint: notConfigured,
      workspaceListed: notConfigured,
      workspaceRevoked: notConfigured,
      redeemed: notConfigured,
      registrationAdmitted: () => Promise.resolve(false),
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
    ...accessWorkspaceLinkRoutes(ports, links, settings),
    redeemed: (caller, token, workspace) =>
      accessInviteLinkRedeemed(ports, links, settings, {
        caller,
        token,
        workspace,
      }),
    registrationAdmitted: async (token) =>
      token !== undefined &&
      token !== "" &&
      (await links.store.opened(links.secrets.digest(token)))?.newAccounts ===
        true,
  };
}
