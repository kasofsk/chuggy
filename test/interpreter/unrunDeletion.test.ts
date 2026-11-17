/**
 * Deleting what never ran: who may ask, what a refusal leaves standing, and
 * that the authority is erased only after the store has deleted, including
 * again for a deletion whose erasure was lost.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  projectDeletion,
  tenantDeletion,
  type AccessErasure,
  type ProjectDeletionHolding,
  type ProjectDeletionStore,
  type TenantDeletionHolding,
  type TenantDeletionStore,
  type UnrunDeletionStored,
} from "../../src/interpreter/unrunDeletion.ts";

const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const tenantAdministrator = asPrincipal("tenant-administrator");
const projectAdministrator = asPrincipal("project-administrator");
const siteAdministrator = asPrincipal("site-administrator");

/** The tenant's administrator administers it, a project's administrator only the project, and the site's the site. */
const access: ProjectAccess = {
  authorize: (principal) =>
    Promise.resolve(
      principal === projectAdministrator || principal === tenantAdministrator
        ? memberAuthority(principal)
        : undefined,
    ),
  authorizeTenant: (principal, _tenant, kind) =>
    Promise.resolve(
      principal === tenantAdministrator && kind === "AdministerTenant"
        ? memberAuthority(principal)
        : undefined,
    ),
  authorizeSite: (principal, kind) =>
    Promise.resolve(
      principal === siteAdministrator && kind === "AdministerSite"
        ? memberAuthority(principal)
        : undefined,
    ),
};

/** Every erasure asked for, in order, and one that fails while `failing` holds. */
function erasureRecorded(): {
  readonly erasure: AccessErasure;
  readonly erased: string[];
  failing: boolean;
} {
  const recorded = {
    erased: [] as string[],
    failing: false,
    erasure: {
      projectErased: (erased: Partition) => {
        if (recorded.failing)
          return Promise.reject(new Error("the authority is out"));
        recorded.erased.push(`${erased.tenant}/${erased.project}`);
        return Promise.resolve();
      },
      tenantErased: (tenant: TenantId) => {
        if (recorded.failing)
          return Promise.reject(new Error("the authority is out"));
        recorded.erased.push(tenant);
        return Promise.resolve();
      },
    },
  };
  return recorded;
}

/** A project's door that answers what holds it, and deletes it once where nothing does. */
function projectStored(held: readonly ProjectDeletionHolding[]): {
  readonly store: ProjectDeletionStore;
  readonly deletes: number[];
} {
  let present = true;
  const deletes: number[] = [];
  return {
    deletes,
    store: {
      holds: () => Promise.resolve(present ? held : undefined),
      delete: (): Promise<
        UnrunDeletionStored<ProjectDeletionHolding, "NotFound">
      > => {
        deletes.push(deletes.length);
        if (!present) return Promise.resolve({ outcome: "NotFound" });
        if (held.length > 0) return Promise.resolve({ outcome: "Held", held });
        present = false;
        return Promise.resolve({ outcome: "Deleted" });
      },
    },
  };
}

function tenantStored(held: readonly TenantDeletionHolding[]): {
  readonly store: TenantDeletionStore;
  readonly deletes: number[];
} {
  const deletes: number[] = [];
  return {
    deletes,
    store: {
      holds: () => Promise.resolve(held),
      delete: (): Promise<UnrunDeletionStored<TenantDeletionHolding>> => {
        deletes.push(deletes.length);
        return Promise.resolve(
          held.length > 0 ? { outcome: "Held", held } : { outcome: "Deleted" },
        );
      },
    },
  };
}

test("a tenant's administrator deletes a project nothing holds, and its tuples are erased after", async () => {
  const recorded = erasureRecorded();
  const stored = projectStored([]);
  const deletion = projectDeletion(
    { access, erasure: recorded.erasure },
    stored.store,
  );
  assert.deepEqual(await deletion.standing(tenantAdministrator, partition), {
    result: "Found",
    held: [],
  });
  assert.deepEqual(await deletion.delete(tenantAdministrator, partition), {
    result: "Deleted",
  });
  assert.deepEqual(recorded.erased, ["tenant/project"]);
  assert.deepEqual(await deletion.standing(tenantAdministrator, partition), {
    result: "NotFound",
  });
});

test("a project holding a released ticket is refused with what holds it, and nothing is erased", async () => {
  const recorded = erasureRecorded();
  const deletion = projectDeletion(
    { access, erasure: recorded.erasure },
    projectStored(["ReleasedTicket", "Execution"]).store,
  );
  assert.deepEqual(await deletion.standing(tenantAdministrator, partition), {
    result: "Found",
    held: ["ReleasedTicket", "Execution"],
  });
  assert.deepEqual(await deletion.delete(tenantAdministrator, partition), {
    result: "Held",
    held: ["ReleasedTicket", "Execution"],
  });
  assert.deepEqual(recorded.erased, []);
});

test("a project's own administrator, or anyone else who is not the tenant's, is answered absent and the store is not asked to delete", async () => {
  const recorded = erasureRecorded();
  const stored = projectStored([]);
  const deletion = projectDeletion(
    { access, erasure: recorded.erasure },
    stored.store,
  );
  for (const principal of [
    projectAdministrator,
    siteAdministrator,
    asPrincipal("stranger"),
  ] satisfies Principal[]) {
    assert.deepEqual(await deletion.standing(principal, partition), {
      result: "NotFound",
    });
    assert.deepEqual(await deletion.delete(principal, partition), {
      result: "NotFound",
    });
  }
  assert.deepEqual(stored.deletes, []);
  assert.deepEqual(recorded.erased, []);
});

test("a project deleted while its erasure was lost is erased by the next request, which answers it absent", async () => {
  const recorded = erasureRecorded();
  const deletion = projectDeletion(
    { access, erasure: recorded.erasure },
    projectStored([]).store,
  );
  recorded.failing = true;
  await assert.rejects(() => deletion.delete(tenantAdministrator, partition));
  recorded.failing = false;
  assert.deepEqual(await deletion.delete(tenantAdministrator, partition), {
    result: "NotFound",
  });
  assert.deepEqual(recorded.erased, ["tenant/project"]);
});

test("the site's administrator deletes a tenant holding no project, erased after, and again where that erasure was lost", async () => {
  const recorded = erasureRecorded();
  const stored = tenantStored([]);
  const deletion = tenantDeletion(
    { access, erasure: recorded.erasure },
    stored.store,
  );
  assert.deepEqual(
    await deletion.standing(siteAdministrator, partition.tenant),
    { result: "Found", held: [] },
  );
  recorded.failing = true;
  await assert.rejects(() =>
    deletion.delete(siteAdministrator, partition.tenant),
  );
  recorded.failing = false;
  assert.deepEqual(await deletion.delete(siteAdministrator, partition.tenant), {
    result: "Deleted",
  });
  assert.deepEqual(recorded.erased, ["tenant"]);
  assert.equal(stored.deletes.length, 2);
});

test("a tenant holding a project is refused with it, and only the site's administrator is answered at all", async () => {
  const recorded = erasureRecorded();
  const stored = tenantStored(["Project"]);
  const deletion = tenantDeletion(
    { access, erasure: recorded.erasure },
    stored.store,
  );
  assert.deepEqual(await deletion.delete(siteAdministrator, partition.tenant), {
    result: "Held",
    held: ["Project"],
  });
  for (const principal of [tenantAdministrator, projectAdministrator]) {
    assert.deepEqual(await deletion.standing(principal, partition.tenant), {
      result: "NotFound",
    });
    assert.deepEqual(await deletion.delete(principal, partition.tenant), {
      result: "NotFound",
    });
  }
  assert.equal(stored.deletes.length, 1);
  assert.deepEqual(recorded.erased, []);
});
