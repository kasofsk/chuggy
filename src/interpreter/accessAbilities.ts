/**
 * What a caller may do at the site, in a tenant or in a project, answered to
 * them alone as the kinds they hold there.
 *
 * EACH ABILITY IS THE KIND'S OWN ANSWER. Nothing is inferred from a role the
 * caller holds, because who holds a kind changes without any role changing. A
 * role is read through the record naming the kind that grants it, the same one
 * a change asks.
 *
 * IT IS ANSWERED TO EXACTLY WHO THE LEVEL'S LIST IS, and every other caller is
 * answered as absent. The list's gate stops at the first kind held; here every
 * list kind is asked once and none is skipped, because each of them is also an
 * ability, and a caller holding none is absent. The site's abilities are
 * answered to a caller holding one of them.
 *
 * A TENANT'S PROJECTS ARE READ UNDER A BUDGET OF THIS ANSWER'S OWN, so a
 * tenant whose own tuples fill a list's budget still names its projects here,
 * and `projectsMax` bounds how many kinds one answer asks.
 */

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessProjectAbilities,
  type AccessProjectAbilitiesHeld,
  type AccessSiteAbilities,
  type AccessTenantAbilities,
} from "../contract/accessPlane.ts";
import {
  accessBudget,
  accessProjectHeld,
  accessProjectListKinds,
  accessProjectRoleGrantKinds,
  accessTenantHeld,
  accessTenantListKinds,
  accessTenantProjects,
  accessTenantRoleGrantKinds,
  accessTuplesRead,
  type AccessPlaneBounds,
  type AccessTupleReader,
} from "./accessPlane.ts";
import type { Principal } from "./principal.ts";
import type {
  ProjectAccess,
  ProjectAccessKind,
  SiteAccessKind,
} from "./projectAccess.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";

export interface AccessAbilitiesPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
}

export interface AccessAbilitiesSettings {
  readonly bounds: AccessPlaneBounds;
}

export interface AccessAbilities {
  tenantAbilities(
    caller: Principal,
    tenant: TenantId,
  ): Promise<AccessTenantAbilities | undefined>;
  projectAbilities(
    caller: Principal,
    partition: Partition,
  ): Promise<AccessProjectAbilities | undefined>;
  siteAbilities(caller: Principal): Promise<AccessSiteAbilities | undefined>;
}

/** The kinds a tenant's answer asks on each project it names. */
const accessAbilitiesProjectKinds: readonly ProjectAccessKind[] = [
  ...accessProjectRoles.map((role) => accessProjectRoleGrantKinds[role]),
  "ManageProjectAuthorities",
];

/** The kinds the site's answer asks, any one of which answers it. */
const accessAbilitiesSiteKinds: readonly SiteAccessKind[] = [
  "AdministerSite",
  "CreateAccount",
  "ManageSiteAuthorities",
];

/** Each of `kinds` the caller holds, every one asked once, in order. */
async function accessAbilitiesHeld<Kind extends string>(
  kinds: readonly Kind[],
  held: (kind: Kind) => Promise<boolean>,
): Promise<ReadonlySet<Kind>> {
  const found = new Set<Kind>();
  for (const kind of kinds) if (await held(kind)) found.add(kind);
  return found;
}

function accessAbilitiesOfProject(
  project: ProjectId,
  held: ReadonlySet<ProjectAccessKind>,
): AccessProjectAbilitiesHeld {
  return {
    project,
    roles: accessProjectRoles.filter((role) =>
      held.has(accessProjectRoleGrantKinds[role]),
    ),
    manageAuthorities: held.has("ManageProjectAuthorities"),
  };
}

/** What the caller may do on each of the tenant's projects, at most the bound. */
async function accessAbilitiesOfProjects(
  ports: AccessAbilitiesPorts,
  settings: AccessAbilitiesSettings,
  caller: Principal,
  tenant: TenantId,
): Promise<{
  readonly projects: AccessProjectAbilitiesHeld[];
  readonly truncated: boolean;
}> {
  const budget = accessBudget(settings.bounds);
  const partitions = accessTenantProjects(
    tenant,
    await accessTuplesRead(ports.tuples, budget, {
      query: "TenantProjects",
      tenant,
    }),
    budget,
  );
  const projects: AccessProjectAbilitiesHeld[] = [];
  for (const partition of partitions)
    projects.push(
      accessAbilitiesOfProject(
        partition.project,
        await accessAbilitiesHeld(accessAbilitiesProjectKinds, (kind) =>
          accessProjectHeld(ports.access, caller, partition, kind),
        ),
      ),
    );
  return { projects, truncated: budget.truncated };
}

async function accessTenantAbilitiesRead(
  ports: AccessAbilitiesPorts,
  settings: AccessAbilitiesSettings,
  caller: Principal,
  tenant: TenantId,
): Promise<AccessTenantAbilities | undefined> {
  const held = await accessAbilitiesHeld(accessTenantListKinds, (kind) =>
    accessTenantHeld(ports.access, caller, tenant, kind),
  );
  if (held.size === 0) return undefined;
  const createAccount =
    (await ports.access.authorizeSite(caller, "CreateAccount")) !== undefined;
  const { projects, truncated } = await accessAbilitiesOfProjects(
    ports,
    settings,
    caller,
    tenant,
  );
  return {
    tenant,
    roles: accessTenantRoles.filter((role) =>
      held.has(accessTenantRoleGrantKinds[role]),
    ),
    grantHostedRuns: held.has("GrantHostedExecution"),
    createAccount,
    manageAuthorities: held.has("ManageTenantAuthorities"),
    manageSiteHeldAuthorities: held.has("ManageSiteHeldAuthorities"),
    projects,
    truncated,
  };
}

export function accessAbilities(
  ports: AccessAbilitiesPorts,
  settings: AccessAbilitiesSettings,
): AccessAbilities {
  return {
    tenantAbilities: (caller, tenant) =>
      accessTenantAbilitiesRead(ports, settings, caller, tenant),
    projectAbilities: async (caller, partition) => {
      const held = await accessAbilitiesHeld(accessProjectListKinds, (kind) =>
        accessProjectHeld(ports.access, caller, partition, kind),
      );
      if (held.size === 0) return undefined;
      return {
        tenant: partition.tenant,
        ...accessAbilitiesOfProject(partition.project, held),
      };
    },
    siteAbilities: async (caller) => {
      const held = await accessAbilitiesHeld(
        accessAbilitiesSiteKinds,
        async (kind) =>
          (await ports.access.authorizeSite(caller, kind)) !== undefined,
      );
      if (held.size === 0) return undefined;
      return {
        administer: held.has("AdministerSite"),
        createAccount: held.has("CreateAccount"),
        manageAuthorities: held.has("ManageSiteAuthorities"),
      };
    },
  };
}
