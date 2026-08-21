import type {
  Principal,
  ProjectAccess,
  ProjectInventory,
} from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";

export interface ProjectInventoryStore {
  projects(
    after: Partition | undefined,
    limit: number,
  ): Promise<readonly Partition[]>;
}

const inventoryScanPagesMax = 4;

export function authorizedProjectInventory(
  access: ProjectAccess,
  store: ProjectInventoryStore,
): ProjectInventory {
  return {
    projects: async (principal: Principal, after, limit) => {
      const visible: Partition[] = [];
      let cursor = after;
      let exhausted = false;
      for (let page = 0; page < inventoryScanPagesMax; page += 1) {
        const batch = await store.projects(cursor, limit);
        if (batch.length === 0) {
          exhausted = true;
          break;
        }
        for (const partition of batch) {
          cursor = partition;
          if (
            (await access.authorize(principal, partition, "Read")) !== undefined
          )
            visible.push(partition);
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
