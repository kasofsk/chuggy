/**
 * The live stream, wired to the query cache.
 *
 * A change frame is written into the cache under the key its kind and resource
 * name, and lists fold the same representation in through registrations this
 * provider holds; nothing here refetches on a live frame. The stream is
 * reopened when the partition changes and when the session's token generation
 * does, because both make the connection in flight the wrong one.
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
import { openProjectStream } from "../core/projectStream.ts";
import type {
  ProjectStreamPorts,
  ProjectStreamStatus,
} from "../core/projectStream.ts";
import { projectPartitionKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { nowMs, sleepMs, streamFetch } from "./ports.ts";
import { useSessionGeneration, useSessionHolder } from "./session.tsx";

export const projectListFoldsMax = 32;

export interface ProjectListChange {
  readonly resource: string;
  readonly representation: unknown;
}

export interface ProjectListFold {
  readonly kind: ProjectChangeKind;
  readonly key: ProjectQueryKey;
  readonly fold: (previous: unknown, change: ProjectListChange) => unknown;
}

interface ProjectStreamHeld {
  readonly folds: Set<ProjectListFold>;
  readonly status: ProjectStreamStatus;
  readonly fallbackExhausted: boolean;
}

const streamStatusInitial: ProjectStreamStatus = {
  connection: "Opening",
  source: "unknown",
  reason: undefined,
  lastSequence: undefined,
};

const ProjectStreamContext = createContext<ProjectStreamHeld | undefined>(
  undefined,
);

function applyCommand(
  client: QueryClient,
  folds: ReadonlySet<ProjectListFold>,
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
          client.setQueryData(registered.key, (previous: unknown) =>
            registered.fold(previous, change),
          );
      return;
    }
    default:
      return;
  }
}

function useStreamConnection(
  partition: PartitionIdentity,
  folds: ReadonlySet<ProjectListFold>,
  transport: ProjectStreamPorts["fetch"],
): ProjectStreamStatus {
  const holder = useSessionHolder();
  const client = useQueryClient();
  const generation = useSessionGeneration();
  const [status, setStatus] =
    useState<ProjectStreamStatus>(streamStatusInitial);
  const { tenant, project } = partition;
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
        onStatus: setStatus,
      },
    );
    return () => {
      opened.stop();
    };
  }, [holder, client, folds, transport, tenant, project, generation]);
  return status;
}

/** The bounded stand-in for a stream that is not carrying changes. */
function useStreamFallback(
  partition: PartitionIdentity,
  status: ProjectStreamStatus,
): boolean {
  const client = useQueryClient();
  const [exhausted, setExhausted] = useState(false);
  const { tenant, project } = partition;
  const degraded =
    status.source === "degraded" ||
    status.connection === "Waiting" ||
    status.connection === "Stopped";
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
  const folds = useMemo(() => new Set<ProjectListFold>(), []);
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
 * A list query folding live changes in for one kind, registered for as long as
 * the screen is mounted and refused past the registration budget.
 */
export function useProjectListFold(
  kind: ProjectChangeKind,
  key: ProjectQueryKey,
  fold: (previous: unknown, change: ProjectListChange) => unknown,
): void {
  const { folds } = useProjectStreamHeld();
  const held = useRef(fold);
  useEffect(() => {
    held.current = fold;
  }, [fold]);
  const named = JSON.stringify(key);
  useEffect(() => {
    if (folds.size >= projectListFoldsMax)
      throw new RangeError("more list folds are registered than are allowed");
    const registration: ProjectListFold = {
      kind,
      key: JSON.parse(named) as ProjectQueryKey,
      fold: (previous, change) => held.current(previous, change),
    };
    folds.add(registration);
    return () => {
      folds.delete(registration);
    };
  }, [folds, kind, named]);
}
