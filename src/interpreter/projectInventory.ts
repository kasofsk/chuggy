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

export function authorizedProjectInventory(
  access: ProjectAccess,
  store: ProjectInventoryStore,
): ProjectInventory {
  return {
    projects: async (principal: Principal, after, limit) => {
      const visible: Partition[] = [];
      let cursor = after;
      while (visible.length < limit) {
        const batch = await store.projects(cursor, limit);
        if (batch.length === 0) break;
        for (const partition of batch) {
          cursor = partition;
          if (
            (await access.authorize(principal, partition, "Read")) !== undefined
          )
            visible.push(partition);
          if (visible.length === limit) break;
        }
        if (batch.length < limit) break;
      }
      return visible;
    },
  };
}
