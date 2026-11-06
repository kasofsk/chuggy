/**
 * A project's epics at the boundary: the reads any reader of the project may
 * make, each reauthorizing before it reaches the store, and the one write,
 * which asks for `Mutate`.
 *
 * A write refused for want of `Mutate` is told apart from a project the caller
 * cannot read: a reader already knows the project is there, and the control
 * they pressed is theirs to be told they do not hold.
 */

import type { EpicHistoryQuery, EpicListQuery } from "../contract/epics.ts";
import type { EpicCommand, EpicOutcome } from "../domain/epics.ts";
import type {
  EpicGraph,
  EpicHistoryPage,
  EpicListPage,
  EpicStore,
  EpicView,
} from "./epicStore.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** A read of one epic: the value, or the absence of a project or epic the caller can see. */
export type EpicRead<Value> =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly value: Value };

/** A write: refused for want of the project, for want of the kind, or decided by the domain. */
export type EpicWritten =
  | { readonly result: "NotFound" }
  | { readonly result: "Forbidden" }
  | { readonly result: "Decided"; readonly outcome: EpicOutcome };

export interface NativeEpics {
  epics(
    principal: Principal,
    partition: Partition,
    query: EpicListQuery,
  ): Promise<EpicRead<EpicListPage>>;
  epic(
    principal: Principal,
    partition: Partition,
    epic: number,
  ): Promise<EpicRead<EpicView>>;
  epicHistory(
    principal: Principal,
    partition: Partition,
    epic: number,
    query: EpicHistoryQuery,
  ): Promise<EpicRead<EpicHistoryPage>>;
  epicGraph(
    principal: Principal,
    partition: Partition,
    epic: number,
  ): Promise<EpicRead<EpicGraph>>;
  writeEpic(
    principal: Principal,
    partition: Partition,
    command: EpicCommand,
  ): Promise<EpicWritten>;
}

function composedEpics(store?: EpicStore): EpicStore {
  if (store === undefined)
    throw new Error("native web: no epic store was composed");
  return store;
}

/** Reads one thing of one epic, which is absent where the epic is. */
function epicReader<Arguments extends unknown[], Value>(
  access: ProjectAccess,
  read: (
    partition: Partition,
    ...args: Arguments
  ) => Promise<Value | undefined>,
) {
  return async (
    principal: Principal,
    partition: Partition,
    ...args: Arguments
  ): Promise<EpicRead<Value>> => {
    if ((await access.authorize(principal, partition, "Read")) === undefined)
      return { result: "NotFound" };
    const value = await read(partition, ...args);
    return value === undefined
      ? { result: "NotFound" }
      : { result: "Found", value };
  };
}

export function nativeEpicMethods(
  access: ProjectAccess,
  store?: EpicStore,
): NativeEpics {
  return {
    epics: epicReader(access, (partition, query: EpicListQuery) =>
      composedEpics(store).list(partition, query),
    ),
    epic: epicReader(access, (partition, epic: number) =>
      composedEpics(store).view(partition, epic),
    ),
    epicHistory: epicReader(
      access,
      (partition, epic: number, query: EpicHistoryQuery) =>
        composedEpics(store).history(partition, epic, query),
    ),
    epicGraph: epicReader(access, (partition, epic: number) =>
      composedEpics(store).graph(partition, epic),
    ),
    writeEpic: async (principal, partition, command) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const authority = await access.authorize(principal, partition, "Mutate");
      if (authority === undefined) return { result: "Forbidden" };
      return {
        result: "Decided",
        outcome: await composedEpics(store).save(partition, command, authority),
      };
    },
  };
}
