import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorInteraction, SelectorStateStore } from "./selector.ts";

export type SelectorHistoryResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly interactions: readonly SelectorInteraction[];
    };

export interface SelectorHistory {
  read(
    principal: Principal,
    partition: Partition,
    after: number | undefined,
    limit: number,
  ): Promise<SelectorHistoryResult>;
}

/** Exposes semantic selector provenance only through current project read access. */
export function selectorHistory(
  access: ProjectAccess,
  store: SelectorStateStore,
): SelectorHistory {
  return {
    read: async (principal, partition, after, limit) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            interactions: await store.history(partition, after, limit),
          },
  };
}
