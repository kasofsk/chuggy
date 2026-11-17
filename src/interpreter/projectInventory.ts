import type {
  InventoryPartition,
  Principal,
  ProjectAccess,
  ProjectInventory,
} from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";

export interface ProjectInventoryStore {
  projects(
    after: Partition | undefined,
    limit: number,
  ): Promise<readonly InventoryPartition[]>;
}

const inventoryScanPagesMax = 4;

export function authorizedProjectInventory(
  access: ProjectAccess,
  store: ProjectInventoryStore,
): ProjectInventory {
  return {
    projects: async (principal: Principal, after, limit) => {
      const visible: InventoryPartition[] = [];
      let cursor: Partition | undefined = after;
      let exhausted = false;
      for (let page = 0; page < inventoryScanPagesMax; page += 1) {
        const batch = await store.projects(cursor, limit);
        if (batch.length === 0) {
          exhausted = true;
          break;
        }
        for (const named of batch) {
          cursor = { tenant: named.tenant, project: named.project };
          if ((await access.authorize(principal, cursor, "Read")) !== undefined)
            visible.push(named);
          if (visible.length === limit) break;
        }
        exhausted = batch.length < limit;
        if (visible.length === limit || exhausted) break;
      }
      return {
        projects: visible,
        ...(!exhausted && cursor !== undefined ? { nextAfter: cursor } : {}),
      };
    },
  };
}
