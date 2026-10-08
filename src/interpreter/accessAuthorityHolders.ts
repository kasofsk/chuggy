/**
 * Adding and removing a holder of one authority of the site, a tenant or a
 * project, for a caller the authority says may manage it.
 *
 * A CALLER IS ASKED BEFORE A HOLDER IS LOOKED AT. One not answered the level's
 * list is absent, and one answered it who lacks the kind this authority asks
 * is refused; only then is the holder considered, so a refused caller learns
 * nothing about it.
 *
 * WHAT MAY BE ADDED IS ONE EXHAUSTIVE RECORD A LEVEL, because Keto stores any
 * tuple and follows any subject set. A person may hold any authority; a group
 * only where the model declares it, named at the request's own tenant and
 * project; and a tenant's administrators only on the site's `AccountCreators`,
 * and only a tenant carrying its `site` link, so a tenant nobody has made is
 * not handed the making of accounts ahead of whoever makes it. No holder is the
 * holders of another authority.
 *
 * WHAT MAY BE REMOVED IS WHAT THE LEVEL'S LIST CAN NAME, admitted or not, so a
 * holder written by hand that the list shows can be taken away. A removal names
 * the whole tuple and never the relation alone. Adding a holder already held
 * and removing one that is not change nothing and succeed.
 *
 * NOTHING KEEPS AN AUTHORITY FROM BEING LEFT WITH NO HOLDER. A tenant or a
 * project whose managers are all removed is still managed from the level above
 * through its link, and the site's administrators always manage the site.
 *
 * TWO GROUPS OPEN A LIST, AND THAT IS MEANT. `GrantMember` answers a tenant's
 * people list, so `TenantMembers` holding `MemberGranters` shows every member
 * that list, with its emails and logins, and lets any member remove another.
 * `ProjectDevelopers` holding `DeveloperGranters` does the same in a project.
 */

import {
  accessProjectGroups,
  accessSiteGroups,
  accessTenantGroups,
  type AccessGroup,
  type AccessProjectAuthority,
  type AccessSiteAuthority,
  type AccessSiteGroup,
  type AccessTenantAuthority,
  type AccessTenantGroup,
} from "../contract/accessPlane.ts";
import {
  accessGroupHolder,
  accessProjectAuthoritiesListed,
  accessProjectAuthorityRelations,
  accessProjectPlace,
  accessSiteAuthoritiesListed,
  accessSiteAuthorityRelations,
  accessSitePlace,
  accessTenantAuthoritiesListed,
  accessTenantAuthorityRelations,
  accessTenantPlace,
  type AccessAuthorityPlace,
} from "./accessAuthorities.ts";
import {
  accessBudget,
  accessProjectHeld,
  accessTenantHeld,
  accessTupleLinkRelation,
  accessTuplesRead,
  type AccessPlaneBounds,
  type AccessTupleReader,
} from "./accessPlane.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
  type TenantAccessKind,
} from "./projectAccess.ts";
import {
  tenantSiteRelation,
  type ProjectGrantSubject,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import type { Partition, TenantId } from "./projectStore.ts";

export interface AccessAuthorityHoldersPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
}

/** The issuer a person's principal is derived under, and what reading a tenant's `site` link may spend. */
export interface AccessAuthorityHoldersSettings {
  readonly issuer: string;
  readonly bounds: AccessPlaneBounds;
}

/** Who a change names: a person by subject, a group of the level, or one tenant's administrators. */
export type AccessHolder =
  | { readonly holder: "Person"; readonly subject: string }
  | { readonly holder: "Group"; readonly group: AccessGroup }
  | { readonly holder: "Tenant"; readonly tenant: TenantId };

/** One holder of one authority, at the level the authority is of. */
export type AccessHeld =
  | {
      readonly level: "Site";
      readonly authority: AccessSiteAuthority;
      readonly holder: AccessHolder;
    }
  | {
      readonly level: "Tenant";
      readonly tenant: TenantId;
      readonly authority: AccessTenantAuthority;
      readonly holder: AccessHolder;
    }
  | {
      readonly level: "Project";
      readonly partition: Partition;
      readonly authority: AccessProjectAuthority;
      readonly holder: AccessHolder;
    };

/** What adding or removing a holder came to. */
export type AccessHolderChange =
  "Absent" | "Changed" | "Refused" | "NotAdmitted";

export interface AccessAuthorityHolders {
  holderAdded(caller: Principal, held: AccessHeld): Promise<AccessHolderChange>;
  holderRemoved(
    caller: Principal,
    held: AccessHeld,
  ): Promise<AccessHolderChange>;
}

/** What one authority admits beside a person: groups, and whether a named tenant's administrators. */
interface AccessAdmitted {
  readonly groups: readonly AccessGroup[];
  readonly tenants: boolean;
}

/** What each of the site's authorities admits. */
export const accessSiteAuthorityAdmits: Readonly<
  Record<
    AccessSiteAuthority,
    {
      readonly groups: readonly AccessSiteGroup[];
      readonly tenants: boolean;
    }
  >
> = {
  AccountCreators: { groups: ["SiteAdmins"], tenants: true },
  AuthorityManagers: { groups: [], tenants: false },
};

/** The groups each of a tenant's authorities admits. */
export const accessTenantAuthorityAdmits: Readonly<
  Record<AccessTenantAuthority, readonly AccessTenantGroup[]>
> = {
  AdminGranters: ["TenantAdmins", "SiteAdmins"],
  MemberGranters: ["TenantAdmins", "SiteAdmins", "TenantMembers"],
  HostedRunsGranters: ["TenantAdmins", "SiteAdmins"],
  AuthorityManagers: ["TenantAdmins"],
};

/** The groups each of a project's authorities admits. */
export const accessProjectAuthorityAdmits: Readonly<
  Record<AccessProjectAuthority, readonly AccessGroup[]>
> = {
  AdminGranters: ["ProjectAdmins", "TenantAdmins", "SiteAdmins"],
  DeveloperGranters: [
    "ProjectAdmins",
    "TenantAdmins",
    "SiteAdmins",
    "ProjectDevelopers",
  ],
  DispatcherGranters: ["ProjectAdmins", "TenantAdmins", "SiteAdmins"],
  AuthorityManagers: ["ProjectAdmins", "TenantAdmins"],
};

/** The kind changing each of a tenant's authorities asks. */
export const accessTenantAuthorityKinds: Readonly<
  Record<AccessTenantAuthority, TenantAccessKind>
> = {
  AdminGranters: "ManageTenantAuthorities",
  MemberGranters: "ManageTenantAuthorities",
  HostedRunsGranters: "ManageSiteHeldAuthorities",
  AuthorityManagers: "ManageTenantAuthorities",
};

/** One change's authority resolved: its tuple's object and relation, what its list names, what it admits, and who may change it. */
interface AccessHolderAuthority {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly place: AccessAuthorityPlace;
  readonly named: readonly AccessGroup[];
  readonly tenantsNamed: boolean;
  readonly admitted: AccessAdmitted;
  readonly listed: () => Promise<boolean>;
  readonly permitted: () => Promise<boolean>;
}

function accessHolderAuthority(
  access: ProjectAccess,
  caller: Principal,
  held: AccessHeld,
): AccessHolderAuthority {
  switch (held.level) {
    case "Site":
      return {
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        relation: accessSiteAuthorityRelations[held.authority],
        place: accessSitePlace,
        named: accessSiteGroups,
        tenantsNamed: true,
        admitted: accessSiteAuthorityAdmits[held.authority],
        listed: () => accessSiteAuthoritiesListed(access, caller),
        permitted: async () =>
          (await access.authorizeSite(caller, "ManageSiteAuthorities")) !==
          undefined,
      };
    case "Tenant":
      return {
        namespace: projectAccessTenantNamespace,
        object: projectAccessTenantObject(held.tenant),
        relation: accessTenantAuthorityRelations[held.authority],
        place: accessTenantPlace(held.tenant),
        named: accessTenantGroups,
        tenantsNamed: false,
        admitted: {
          groups: accessTenantAuthorityAdmits[held.authority],
          tenants: false,
        },
        listed: () =>
          accessTenantAuthoritiesListed(access, caller, held.tenant),
        permitted: () =>
          accessTenantHeld(
            access,
            caller,
            held.tenant,
            accessTenantAuthorityKinds[held.authority],
          ),
      };
    case "Project":
      return {
        namespace: projectAccessNamespace,
        object: projectAccessObject(held.partition),
        relation: accessProjectAuthorityRelations[held.authority],
        place: accessProjectPlace(held.partition),
        named: accessProjectGroups,
        tenantsNamed: false,
        admitted: {
          groups: accessProjectAuthorityAdmits[held.authority],
          tenants: false,
        },
        listed: () =>
          accessProjectAuthoritiesListed(access, caller, held.partition),
        permitted: () =>
          accessProjectHeld(
            access,
            caller,
            held.partition,
            "ManageProjectAuthorities",
          ),
      };
  }
}

/** The subject `holder` is written as, or nothing where `authority` may not hold it for this verb. */
function accessHolderSubject(
  settings: AccessAuthorityHoldersSettings,
  authority: AccessHolderAuthority,
  holder: AccessHolder,
  verb: "write" | "remove",
): ProjectGrantSubject | undefined {
  switch (holder.holder) {
    case "Person":
      return {
        subject: "Principal",
        principal: oidcPrincipal(settings.issuer, holder.subject),
      };
    case "Group":
      return (
        verb === "write"
          ? authority.admitted.groups.includes(holder.group)
          : authority.named.includes(holder.group)
      )
        ? accessGroupHolder(authority.place, holder.group)
        : undefined;
    case "Tenant":
      return (
        verb === "write" ? authority.admitted.tenants : authority.tenantsNamed
      )
        ? accessGroupHolder(accessTenantPlace(holder.tenant), "TenantAdmins")
        : undefined;
  }
}

/** Whether `tenant` carries its `site` link, read of that relation alone. */
async function accessTenantSited(
  ports: AccessAuthorityHoldersPorts,
  settings: AccessAuthorityHoldersSettings,
  tenant: TenantId,
): Promise<boolean> {
  const links = await accessTuplesRead(
    ports.tuples,
    accessBudget(settings.bounds),
    {
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      relation: tenantSiteRelation,
    },
  );
  return links.some(
    ({ subject }) =>
      subject.subject === "Set" &&
      subject.namespace === projectAccessSiteNamespace &&
      subject.object === projectAccessSiteObject &&
      subject.relation === accessTupleLinkRelation,
  );
}

function accessHolderChanged(
  ports: AccessAuthorityHoldersPorts,
  settings: AccessAuthorityHoldersSettings,
  verb: "write" | "remove",
) {
  return async (
    caller: Principal,
    held: AccessHeld,
  ): Promise<AccessHolderChange> => {
    const authority = accessHolderAuthority(ports.access, caller, held);
    if (!(await authority.listed())) return "Absent";
    if (!(await authority.permitted())) return "Refused";
    const holder = accessHolderSubject(settings, authority, held.holder, verb);
    if (holder === undefined) return "NotAdmitted";
    if (
      verb === "write" &&
      held.holder.holder === "Tenant" &&
      !(await accessTenantSited(ports, settings, held.holder.tenant))
    )
      return "Absent";
    await ports.grants[verb]({
      namespace: authority.namespace,
      object: authority.object,
      relation: authority.relation,
      holder,
    });
    return "Changed";
  };
}

export function accessAuthorityHolders(
  ports: AccessAuthorityHoldersPorts,
  settings: AccessAuthorityHoldersSettings,
): AccessAuthorityHolders {
  if (settings.issuer.length === 0)
    throw new RangeError("access authority holders: the issuer is empty");
  return {
    holderAdded: accessHolderChanged(ports, settings, "write"),
    holderRemoved: accessHolderChanged(ports, settings, "remove"),
  };
}
