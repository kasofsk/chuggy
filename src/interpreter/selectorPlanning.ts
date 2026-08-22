import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorPlanningIntent } from "./selector.ts";

export interface SelectorPlanningStore {
  planningIntent(
    partition: Partition,
  ): Promise<SelectorPlanningIntent | undefined>;
}

export type SelectorPlanningResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly planningIntent?: SelectorPlanningIntent;
    };

export interface SelectorPlanning {
  current(
    principal: Principal,
    partition: Partition,
  ): Promise<SelectorPlanningResult>;
}

/** Exposes the current non-authoritative plan under ordinary project read access. */
export function selectorPlanning(
  access: ProjectAccess,
  store: SelectorPlanningStore,
): SelectorPlanning {
  return {
    current: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const planningIntent = await store.planningIntent(partition);
      return {
        result: "Found",
        ...(planningIntent === undefined ? {} : { planningIntent }),
      };
    },
  };
}
