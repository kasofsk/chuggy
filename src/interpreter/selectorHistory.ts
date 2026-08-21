import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type {
  SelectorStateStore,
  StoredSelectorInteraction,
} from "./selector.ts";

export type SelectorHistoryResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly interactions: readonly StoredSelectorInteraction[];
      readonly nextAfter?: number;
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
        : await (async () => {
            const interactions = await store.history(partition, after, limit);
            const nextAfter = interactions.at(-1)?.ordinal;
            return {
              result: "Found" as const,
              interactions,
              ...(nextAfter === undefined ? {} : { nextAfter }),
            };
          })(),
  };
}
