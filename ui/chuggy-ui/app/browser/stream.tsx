/**
 * The live stream, wired to the query cache.
 *
 * A change frame is written into the cache under the key its kind and resource
 * name, and lists take the same representation through registrations this
 * provider holds — folded in where the frame carries the entry, read again
 * where it only says the entry is stale. The stream is reopened when the
 * partition changes and when the session's token generation does, because both
 * make the connection in flight the wrong one.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import { projectCacheCommands } from "../core/projectCacheCommands.ts";
import type { ProjectCacheCommand } from "../core/projectCacheCommands.ts";
import { runProjectFallback } from "../core/projectFallback.ts";
import {
  openProjectStream,
  projectStreamCarrying,
} from "../core/projectStream.ts";
import type {
  ProjectStreamPorts,
  ProjectStreamStatus,
} from "../core/projectStream.ts";
import { projectPartitionKey } from "../core/projectQueryKeys.ts";
import type {
  ProjectList,
  ProjectListChange,
  ProjectListRefresh,
  ProjectQueryKey,
} from "../core/projectQueryKeys.ts";
import { nowMs, sleepMs, streamFetch } from "./ports.ts";
import { useSessionGeneration, useSessionHolder } from "./session.tsx";

export const projectListFoldsMax = 32;

/**
 * One mounted list, with its entry's type erased because the registry holds
 * every kind at once. The refresh is reached through a call rather than held,
 * so a rerendered screen's own closures are the ones a frame runs.
 */
interface ProjectListRegistration {
  readonly kind: ProjectChangeKind;
  readonly key: ProjectQueryKey;
  readonly refresh: () => ProjectListRefresh<unknown>;
}

interface ProjectStreamHeld {
  readonly folds: Set<ProjectListRegistration>;
  readonly status: ProjectStreamStatus;
  readonly fallbackExhausted: boolean;
}

const streamStatusInitial: ProjectStreamStatus = {
  connection: "Opening",
  source: "unknown",
  reason: undefined,
  lastSequence: undefined,
  answered: false,
};

const ProjectStreamContext = createContext<ProjectStreamHeld | undefined>(
  undefined,
);

function applyListRefresh(
  client: QueryClient,
  registered: ProjectListRegistration,
  change: ProjectListChange,
): void {
  const refresh = registered.refresh();
  switch (refresh.refresh) {
    case "Fold":
      client.setQueryData(registered.key, (previous: unknown) =>
        refresh.fold(previous, change),
      );
      return;
    case "Reread":
      if (refresh.stale(change))
        void client.invalidateQueries({
          queryKey: registered.key,
          exact: true,
        });
      return;
  }
}

function applyCommand(
  client: QueryClient,
  folds: ReadonlySet<ProjectListRegistration>,
  command: ProjectCacheCommand,
): void {
  switch (command.command) {
    case "WriteResource":
      client.setQueryData(command.key, command.representation);
      return;
    case "DropResource":
      client.removeQueries({ queryKey: command.key, exact: true });
      return;
    case "InvalidatePartition":
      void client.invalidateQueries({ queryKey: command.key });
      return;
    case "FoldLists": {
      const change = {
        resource: command.resource,
        representation: command.representation,
      };
      for (const registered of folds)
        if (registered.kind === command.kind)
          applyListRefresh(client, registered, change);
      return;
    }
    default:
      return;
  }
}

function useStreamConnection(
  partition: PartitionIdentity,
  folds: ReadonlySet<ProjectListRegistration>,
  transport: ProjectStreamPorts["fetch"],
): ProjectStreamStatus {
  const holder = useSessionHolder();
  const client = useQueryClient();
  const generation = useSessionGeneration();
  const [status, setStatus] =
    useState<ProjectStreamStatus>(streamStatusInitial);
  const { tenant, project } = partition;

  /**
   * What this console has learnt about this partition's stream, which outlives
   * any one run of it: a token renewal replaces the run under a reader who has
   * gone nowhere, and a run counting from nothing would report that reopen as a
   * first open and take the banner down over a screen that had stopped
   * updating. A different project is a first open of its own, and this effect
   * is declared before the one below so the forgetting happens first.
   */
  const answered = useRef(false);
  useEffect(() => {
    answered.current = false;
  }, [tenant, project]);

  useEffect(() => {
    const opened = openProjectStream(
      {
        fetch: transport,
        bearer: () => holder.bearer(),
        sleepMs,
        nowMs,
      },
      { tenant, project },
      {
        onEvent: (event) => {
          for (const command of projectCacheCommands(
            { tenant, project },
            event,
          ))
            applyCommand(client, folds, command);
        },
        onStatus: (reported) => {
          if (reported.answered) answered.current = true;
          setStatus(reported);
        },
      },
      answered.current,
    );
    return () => {
      opened.stop();
    };
  }, [holder, client, folds, transport, tenant, project, generation]);
  return status;
}

/**
 * The bounded stand-in for a stream that is not carrying changes.
 *
 * `projectStreamCarrying` is false through `Opening`, which is what makes this
 * boolean constant across a reopen: the connection passes back through
 * `Opening` at every rung of the backoff ladder, and a condition that excluded
 * it aborted and restarted the loop five times over — while the loop sleeps
 * before its first refetch, so none of the five ever reached one.
 */
function useStreamFallback(
  partition: PartitionIdentity,
  status: ProjectStreamStatus,
): boolean {
  const client = useQueryClient();
  const [exhausted, setExhausted] = useState(false);
  const { tenant, project } = partition;
  const degraded = !projectStreamCarrying(status);
  useEffect(() => {
    if (!degraded) return;
    const controller = new AbortController();
    void runProjectFallback(
      { sleepMs },
      () => {
        void client.invalidateQueries({
          queryKey: projectPartitionKey({ tenant, project }),
        });
      },
      controller.signal,
    ).then((end) => {
      if (end === "Exhausted") setExhausted(true);
    });
    return () => {
      controller.abort();
      setExhausted(false);
    };
  }, [client, degraded, tenant, project]);
  return exhausted;
}

/** The transport is a parameter so a suite can drive the provider with a double. */
export function ProjectStreamProvider(props: {
  readonly partition: PartitionIdentity;
  readonly transport?: ProjectStreamPorts["fetch"];
  readonly children: ReactNode;
}): ReactNode {
  const folds = useMemo(() => new Set<ProjectListRegistration>(), []);
  const transport = props.transport ?? streamFetch;
  const status = useStreamConnection(props.partition, folds, transport);
  const fallbackExhausted = useStreamFallback(props.partition, status);
  const held = useMemo<ProjectStreamHeld>(
    () => ({ folds, status, fallbackExhausted }),
    [folds, status, fallbackExhausted],
  );
  return (
    <ProjectStreamContext.Provider value={held}>
      {props.children}
    </ProjectStreamContext.Provider>
  );
}

function useProjectStreamHeld(): ProjectStreamHeld {
  const held = useContext(ProjectStreamContext);
  if (held === undefined)
    throw new Error("the stream was read outside the provider that holds it");
  return held;
}

export function useProjectStreamStatus(): ProjectStreamStatus {
  return useProjectStreamHeld().status;
}

export function useProjectFallbackExhausted(): boolean {
  return useProjectStreamHeld().fallbackExhausted;
}

/**
 * A list's refresh, registered for as long as the screen is mounted and refused
 * past the registration budget. `usePanelList` is the caller that matters: this
 * is exported for the suite that drives the registry with no panel under it,
 * and a registration with no query beneath it refreshes nothing.
 */
export function useProjectListRefresh<T>(list: ProjectList<T>): void {
  const { folds } = useProjectStreamHeld();
  const held = useRef(list);
  useEffect(() => {
    held.current = list;
  }, [list]);
  const kind = list.kind;
  const named = JSON.stringify(list.key);
  useEffect(() => {
    if (folds.size >= projectListFoldsMax)
      throw new RangeError("more list folds are registered than are allowed");
    const registration: ProjectListRegistration = {
      kind,
      key: JSON.parse(named) as ProjectQueryKey,
      refresh: () => {
        const current = held.current.refresh;
        return current.refresh === "Reread"
          ? current
          : {
              refresh: "Fold",
              fold: (previous, change) =>
                current.fold(previous as T | undefined, change),
            };
      },
    };
    folds.add(registration);
    return () => {
      folds.delete(registration);
    };
  }, [folds, kind, named]);
}
