/**
 * `AccessErasure` over Ory Keto: a delete through the write API whose query
 * leaves the relation and the subject open, so one request removes every tuple
 * on an object, or every tuple a set holds on one.
 *
 * A TENANT'S PROJECTS ARE ERASED BEFORE THE TENANT, each found by the tuple
 * naming the tenant as its own, so a project whose row is gone and whose
 * erasure the authority lost is not left granting anyone a name another tenant
 * may take. Erasing a project removes the tuple that found it, so each round
 * reads the first page again, and the rounds are bounded: a tenant that still
 * names a project after them is an authority that is not erasing.
 */

import {
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccessSettings,
} from "../../interpreter/projectAccess.ts";
import { accessGroupHolders } from "../../interpreter/accessAuthorities.ts";
import type { ProjectGrantSettings } from "../../interpreter/projectGrant.ts";
import type { TenantId } from "../../interpreter/projectStore.ts";
import type { AccessErasure } from "../../interpreter/unrunDeletion.ts";
import { ketoAccessTuples } from "./accessTuples.ts";
import { ketoAdminTuplesPath } from "./projectGrants.ts";
import { ketoRequest } from "./request.ts";

/** How many pages of a tenant's projects one erasure reads and erases before it gives up. */
export const ketoTenantProjectRoundsMax = 64;

export function ketoAccessErasure(
  read: ProjectAccessSettings,
  write: ProjectGrantSettings,
  fetcher: typeof fetch = fetch,
): AccessErasure {
  const tuples = ketoAccessTuples(read, fetcher);
  const erased = async (
    query: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const url = new URL(ketoAdminTuplesPath, write.writeUrl);
    for (const [name, value] of Object.entries(query))
      url.searchParams.set(name, value);
    await ketoRequest({
      url,
      method: "DELETE",
      requestTimeoutMs: write.requestTimeoutMs,
      fetcher,
    });
  };
  const objectErased = (object: string): Promise<void> =>
    erased({ namespace: projectAccessNamespace, object });
  const tenantProjectsErased = async (tenant: TenantId): Promise<void> => {
    for (let round = 0; round < ketoTenantProjectRoundsMax; round += 1) {
      const page = await tuples.page(
        { query: "TenantProjects", tenant },
        undefined,
      );
      if (page.tuples.length === 0) return;
      for (const tuple of page.tuples) await objectErased(tuple.object);
    }
    throw new ProjectAccessUnavailable(
      "the tenant still names a project after every erasure round",
    );
  };
  return {
    projectErased: (partition) => objectErased(projectAccessObject(partition)),
    tenantErased: async (tenant) => {
      await tenantProjectsErased(tenant);
      const object = projectAccessTenantObject(tenant);
      await erased({ namespace: projectAccessTenantNamespace, object });
      await erased({
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        "subject_set.namespace": projectAccessTenantNamespace,
        "subject_set.object": object,
        "subject_set.relation": accessGroupHolders.TenantAdmins.relation,
      });
    },
  };
}
