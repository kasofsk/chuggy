/**
 * Where the project's threads and lead run and the runners they would run on,
 * as every screen that says so reads it, and the one line that says a runner
 * cannot take a turn now.
 */

import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SessionPlacementResponse } from "../../../../src/contract/responses.ts";
import { apiSessionPlacement } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { navRoutes } from "../core/shellNav.ts";
import {
  sessionPlacementPolledMs,
  sessionPlacementShort,
  sessionRunnerShortWord,
} from "../core/sessionRunners.ts";
import type { SessionRunnerShort } from "../core/sessionRunners.ts";
import { usePanelResourceSettled } from "./api.ts";
import { Notice } from "./ui/Notice.tsx";

/** No frame names the placement or a runner's poll, so the read is polled. */
export const sessionPlacementResource = "session-placement";

/** The placement, with whether its read has ever come back. */
export function useSessionPlacementSettled(partition: PartitionIdentity): {
  readonly state: PanelState<SessionPlacementResponse>;
  readonly settled: boolean;
} {
  return usePanelResourceSettled(
    partition,
    "Project",
    sessionPlacementResource,
    (ports) => apiSessionPlacement(ports, partition),
    sessionPlacementPolledMs,
  );
}

export function useSessionPlacement(
  partition: PartitionIdentity,
): PanelState<SessionPlacementResponse> {
  return useSessionPlacementSettled(partition).state;
}

/** Why no runner can take one session's turn, once the placement is read. */
export function useSessionRunnerShort(
  partition: PartitionIdentity,
  session: "thread" | "lead",
  runners: keyof SessionPlacementResponse["runners"],
): SessionRunnerShort | undefined {
  const placement = useSessionPlacement(partition);
  return sessionPlacementShort(
    placement.state === "Ready" ? placement.value : undefined,
    session,
    runners,
  );
}

/** How many times the placement has answered: every read that landed and
 * every write held as one moves it, and a failed read does not. */
export function useSessionPlacementReads(partition: PartitionIdentity): number {
  const client = useQueryClient();
  const key = projectResourceKey(
    partition,
    "Project",
    sessionPlacementResource,
  );
  const subscribe = useCallback(
    (changed: () => void) => client.getQueryCache().subscribe(changed),
    [client],
  );
  return useSyncExternalStore(
    subscribe,
    () => client.getQueryState(key)?.dataUpdateCount ?? 0,
  );
}

/** Reads the placement again now, for a door whose refusal is newer than it:
 * the route or the reader's runner has moved since the last poll. Answers, once
 * the read has, how many reads had answered when the refusal arrived. */
export function useSessionPlacementStale(
  partition: PartitionIdentity,
): () => Promise<number> {
  const client = useQueryClient();
  const key = projectResourceKey(
    partition,
    "Project",
    sessionPlacementResource,
  );
  return async () => {
    const reads = client.getQueryState(key)?.dataUpdateCount ?? 0;
    await client.invalidateQueries({ queryKey: key });
    return reads;
  };
}

/** Why no runner can take a turn now, with where one is added where none is. */
export function SessionRunnerNotice(props: {
  readonly partition: PartitionIdentity;
  readonly short: SessionRunnerShort;
}): ReactNode {
  return (
    <Notice tone="parked" inline detail={sessionRunnerShortWord(props.short)}>
      {props.short === "NoRunner" ? (
        <span className="text-ink-3">
          {" · "}
          <Link to={navRoutes.runners} params={props.partition}>
            Runners
          </Link>
        </span>
      ) : null}
    </Notice>
  );
}
