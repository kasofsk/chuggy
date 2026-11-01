/**
 * The live stream, wired to the query cache.
 *
 * A change frame is written into the cache under the key its kind and resource
 * name, and lists take the same representation through registrations this
 * provider holds — folded in where the frame carries the entry, read again
 * where it only says the entry is stale. The stream is reopened when the
 * partition changes and when the session's token generation does, because both
 * make the connection in flight the wrong one.
 *
 * ONE GRACE IS READ ON BOTH SIDES OF A STREAM THAT STOPS CARRYING: the banner
 * draws nothing and the fallback reads nothing until it has not carried for
 * `streamGraceMs`, so a reopen the server asked for is seen by neither.
 *
 * THE WIRING AND THE STATUS ARE TWO CONTEXTS. Every list holder reads the
 * wiring, which never changes under a partition, so a frame or a status that
 * changes draws only what reads the status.
 */

import { hashKey, useQueryClient } from "@tanstack/react-query";
import type { Query, QueryClient } from "@tanstack/react-query";
import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import { apiBearerOver } from "../core/apiPorts.ts";
import { ApiOutcomeError } from "../core/apiRequest.ts";
import { projectCacheCommands } from "../core/projectCacheCommands.ts";
import type {
  ProjectCacheCommand,
  ProjectResourceArrival,
} from "../core/projectCacheCommands.ts";
import { runProjectFallback } from "../core/projectFallback.ts";
import type { ProjectFallbackTick } from "../core/projectFallback.ts";
import {
  openProjectStream,
  projectStreamCarrying,
  projectStreamHeldInitial,
  projectStreamHolding,
} from "../core/projectStream.ts";
import type {
  ProjectStreamHeld,
  ProjectStreamStatus,
} from "../core/projectStream.ts";
import { projectPartitionKey } from "../core/projectQueryKeys.ts";
import type {
  ProjectList,
  ProjectListChange,
  ProjectListRefresh,
  ProjectQueryKey,
} from "../core/projectQueryKeys.ts";
import type { StreamPorts } from "../core/streamConnection.ts";
import { deadlineMs, logWarned, nowMs, sleepMs, streamFetch } from "./ports.ts";
import { useSessionGeneration, useSessionHolder } from "./session.tsx";

export const projectListFoldsMax = 32;
export const streamGraceMs = 10_000;

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

/** What a partition's stream is reached through, constant under it. */
interface ProjectStreamWiring {
  readonly ports: StreamPorts;
  readonly folds: Set<ProjectListRegistration>;
}

/** What a partition's stream is saying, whether the grace has run out, and
 * whether this console has been answered in a shape it cannot read. */
interface ProjectStreamSaying {
  readonly status: ProjectStreamStatus;
  readonly lapsed: boolean;
  readonly fallbackExhausted: boolean;
  readonly outdated: boolean;
}

const streamStatusInitial: ProjectStreamStatus = {
  connection: "Opening",
  source: "unknown",
  cause: undefined,
  answered: false,
};

const ProjectStreamContext = createContext<ProjectStreamWiring | undefined>(
  undefined,
);

const ProjectStreamSayingContext = createContext<
  ProjectStreamSaying | undefined
>(undefined);

/**
 * THE REREAD KEEPS `cancelRefetch`'S DEFAULT, which restarts the read in
 * flight. Joining it instead issues no request and clears the invalidation on
 * settling, so a frame arriving mid-read is swallowed and the entry keeps an
 * answer the server gave before that frame's change existed
 * (kasofsk/chuggy#443 carries what restarting costs).
 */
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
    case "FoldElseReread":
      if (refresh.rereads(client.getQueryData(registered.key), change))
        void client.invalidateQueries({
          queryKey: registered.key,
          exact: true,
        });
      else
        client.setQueryData(registered.key, (previous: unknown) =>
          refresh.fold(previous, change),
        );
      return;
    case "Reread":
      void client.invalidateQueries({
        queryKey: registered.key,
        exact: true,
      });
      return;
    case "RereadNamed":
      if (refresh.names(change, client.getQueryData(registered.key)))
        void client.invalidateQueries({
          queryKey: registered.key,
          exact: true,
        });
      return;
  }
}

/** What an arrival does to its key, whether a frame or a screen's own
 * confirmation brought it. */
export function applyResourceArrival(
  client: QueryClient,
  key: ProjectQueryKey,
  arrival: ProjectResourceArrival,
): void {
  switch (arrival.arrival) {
    case "Write":
      client.setQueryData(key, arrival.representation);
      return;
    case "Keep":
      return;
    case "Reread":
      void client.invalidateQueries({ queryKey: key, exact: true });
      return;
  }
}

/** A frame reaches each list once, however many components draw it: every
 * registration under one key reads the same entry, and a second reread would
 * restart the first. */
function applyCommand(
  client: QueryClient,
  folds: ReadonlySet<ProjectListRegistration>,
  command: ProjectCacheCommand,
): void {
  switch (command.command) {
    case "WriteResource":
      client.setQueryData(command.key, command.representation);
      return;
    case "ReviseResource":
      applyResourceArrival(
        client,
        command.key,
        command.revise(client.getQueryData(command.key)),
      );
      return;
    case "RereadResource":
      void client.invalidateQueries({ queryKey: command.key, exact: true });
      return;
    case "InvalidatePartition":
      void client.invalidateQueries({ queryKey: command.key });
      return;
    case "FoldLists": {
      const change = {
        resource: command.resource,
        representation: command.representation,
      };
      const applied = new Set<string>();
      for (const registered of folds) {
        if (registered.kind !== command.kind) continue;
        const keyed = hashKey(registered.key);
        if (applied.has(keyed)) continue;
        applied.add(keyed);
        applyListRefresh(client, registered, change);
      }
      return;
    }
    default:
      return;
  }
}

function useStreamConnection(
  partition: PartitionIdentity,
  folds: ReadonlySet<ProjectListRegistration>,
  ports: StreamPorts,
  outdate: () => void,
): ProjectStreamStatus {
  const client = useQueryClient();
  const generation = useSessionGeneration();
  const [status, setStatus] =
    useState<ProjectStreamStatus>(streamStatusInitial);
  const { tenant, project } = partition;

  /**
   * What this console has learnt about this partition's stream, which outlives
   * any one run of it: a token renewal replaces the run under a reader who has
   * gone nowhere, and the next run replays from its cursor and knows it is not
   * a first open. A different project is a first open of its own, and this
   * effect is declared before the one below so the forgetting happens first.
   */
  const held = useRef<ProjectStreamHeld>(projectStreamHeldInitial());
  useEffect(() => {
    held.current = projectStreamHeldInitial();
  }, [tenant, project]);

  useEffect(() => {
    const opened = openProjectStream(
      ports,
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
        onSkipped: () => {
          outdate();
          void client.invalidateQueries({
            queryKey: projectPartitionKey({ tenant, project }),
          });
        },
      },
      held.current,
    );
    return () => {
      opened.stop();
    };
  }, [ports, client, folds, outdate, tenant, project, generation]);
  return status;
}

/** A JSON document the console's own schema refused, and not a body that was
 * never JSON, which a proxy's page answers too. */
function streamOutdatedRead(error: unknown): boolean {
  return (
    error instanceof ApiOutcomeError &&
    error.result.outcome === "Unreadable" &&
    error.result.shapeRefused === true
  );
}

/**
 * Whether this console has met an answer whose shape it cannot read — a frame
 * the stream skipped, or a read whose document the schema refused — which is an
 * API newer than the console. Within the partition nothing unsets it, because
 * only a reload makes the console newer; leaving the partition unmounts it.
 */
function useStreamOutdated(): readonly [boolean, () => void] {
  const client = useQueryClient();
  const [outdated, setOutdated] = useState(false);
  const outdate = useCallback(() => {
    setOutdated(true);
  }, []);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "error" &&
          streamOutdatedRead(event.action.error)
        )
          outdate();
      }),
    [client, outdate],
  );
  return [outdated, outdate];
}

/**
 * Whether the stream has not carried for the grace. `projectStreamCarrying` is
 * false through `Opening` and `Waiting` alike, so this stays constant across a
 * whole reopen ladder rather than restarting its wait at every rung.
 */
function useStreamLapsed(
  partition: PartitionIdentity,
  carrying: boolean,
): boolean {
  const [lapsed, setLapsed] = useState(false);
  const { tenant, project } = partition;
  useEffect(() => {
    if (carrying) return;
    const controller = new AbortController();
    sleepMs(streamGraceMs, controller.signal).then(
      () => {
        setLapsed(true);
      },
      () => undefined,
    );
    return () => {
      controller.abort();
      setLapsed(false);
    };
  }, [carrying, tenant, project]);
  return lapsed;
}

/** What one tick's reads came to: failed where every query it read failed. */
function streamFallbackTick(queries: readonly Query[]): ProjectFallbackTick {
  return queries.length > 0 &&
    queries.every((query) => query.state.status === "error")
    ? "Failed"
    : "Read";
}

/** The bounded stand-in for a stream that has not carried for the grace. */
function useStreamFallback(
  partition: PartitionIdentity,
  lapsed: boolean,
): boolean {
  const client = useQueryClient();
  const [exhausted, setExhausted] = useState(false);
  const { tenant, project } = partition;
  useEffect(() => {
    if (!lapsed) return;
    const controller = new AbortController();
    const queryKey = projectPartitionKey({ tenant, project });
    void runProjectFallback(
      { sleepMs },
      async () => {
        await client.invalidateQueries({ queryKey });
        return streamFallbackTick(
          client.getQueryCache().findAll({ queryKey, type: "active" }),
        );
      },
      controller.signal,
    ).then((end) => {
      if (end === "Exhausted") setExhausted(true);
    });
    return () => {
      controller.abort();
      setExhausted(false);
    };
  }, [client, lapsed, tenant, project]);
  return exhausted;
}

/**
 * A stream that carries again after a gap has replayed what the gap held, so
 * what is healthy is left alone and only what failed in the gap is read again.
 */
function useStreamRecovered(
  partition: PartitionIdentity,
  carrying: boolean,
): void {
  const client = useQueryClient();
  const { tenant, project } = partition;
  const carried = useRef(false);
  useEffect(() => {
    carried.current = false;
  }, [tenant, project]);
  useEffect(() => {
    if (!carrying) return;
    if (carried.current)
      void client.invalidateQueries({
        queryKey: projectPartitionKey({ tenant, project }),
        predicate: (query) => query.state.status === "error",
      });
    carried.current = true;
  }, [client, carrying, tenant, project]);
}

/** The one transport and bearer a stream is opened through. */
function useStreamPortsMade(
  transport: StreamPorts["fetch"] | undefined,
): StreamPorts {
  const holder = useSessionHolder();
  const fetch = transport ?? streamFetch;
  return useMemo<StreamPorts>(
    () => ({
      fetch,
      bearer: apiBearerOver(holder),
      sleepMs,
      deadlineMs,
      nowMs,
    }),
    [fetch, holder],
  );
}

/** The transport is a parameter so a suite can drive the provider with a double. */
export function ProjectStreamProvider(props: {
  readonly partition: PartitionIdentity;
  readonly transport?: StreamPorts["fetch"];
  readonly children: ReactNode;
}): ReactNode {
  const folds = useMemo(() => new Set<ProjectListRegistration>(), []);
  const ports = useStreamPortsMade(props.transport);
  const [outdated, outdate] = useStreamOutdated();
  const status = useStreamConnection(props.partition, folds, ports, outdate);
  const carrying = projectStreamCarrying(status);
  const lapsed = useStreamLapsed(props.partition, carrying);
  const fallbackExhausted = useStreamFallback(props.partition, lapsed);
  useStreamRecovered(props.partition, carrying);
  const wiring = useMemo<ProjectStreamWiring>(
    () => ({ ports, folds }),
    [ports, folds],
  );
  const saying = useMemo<ProjectStreamSaying>(
    () => ({ status, lapsed, fallbackExhausted, outdated }),
    [status, lapsed, fallbackExhausted, outdated],
  );
  return (
    <ProjectStreamContext.Provider value={wiring}>
      <ProjectStreamSayingContext.Provider value={saying}>
        {props.children}
      </ProjectStreamSayingContext.Provider>
    </ProjectStreamContext.Provider>
  );
}

function useProjectStreamSaying(): ProjectStreamSaying {
  const saying = useContext(ProjectStreamSayingContext);
  if (saying === undefined)
    throw new Error("the stream was read outside the provider that holds it");
  return saying;
}

export function useProjectStreamStatus(): ProjectStreamStatus {
  return useProjectStreamSaying().status;
}

/** Whether the partition's stream holds a position, which no stream does where
 * there is no provider to hold one. */
export function useProjectStreamHolding(): boolean {
  const saying = useContext(ProjectStreamSayingContext);
  return saying !== undefined && projectStreamHolding(saying.status);
}

/** `useProjectStreamHolding`, heard only where `asked`, so a screen that does
 * not ask is not drawn again whenever the stream's status moves. */
export function useProjectStreamHoldingAsked(asked: boolean): boolean {
  if (!asked) return false;
  const saying = use(ProjectStreamSayingContext);
  return saying !== undefined && projectStreamHolding(saying.status);
}

/** Whether the stream has not carried for the grace. */
export function useProjectStreamLapsed(): boolean {
  return useProjectStreamSaying().lapsed;
}

const StreamPortsContext = createContext<StreamPorts | undefined>(undefined);

/** What a stream is opened through on a screen outside every project, which
 * holds no project's stream to take them from. The transport is a parameter
 * so a suite can drive the provider with a double. */
export function StreamPortsProvider(props: {
  readonly transport?: StreamPorts["fetch"];
  readonly children: ReactNode;
}): ReactNode {
  const ports = useStreamPortsMade(props.transport);
  return (
    <StreamPortsContext.Provider value={ports}>
      {props.children}
    </StreamPortsContext.Provider>
  );
}

/** What a stream beside the project's own is opened through, so every stream
 * this console holds reaches the network by one transport and one bearer. */
export function useStreamPorts(): StreamPorts {
  const project = useContext(ProjectStreamContext);
  const outside = useContext(StreamPortsContext);
  const ports = project?.ports ?? outside;
  if (ports === undefined)
    throw new Error("a stream was opened outside a provider of its ports");
  return ports;
}

export function useProjectFallbackExhausted(): boolean {
  return useProjectStreamSaying().fallbackExhausted;
}

/** Whether this console has been answered in a shape it cannot read. */
export function useProjectStreamOutdated(): boolean {
  return useProjectStreamSaying().outdated;
}

/** A list's own refresh, over an entry whose type the registry has erased. */
function projectListRefreshErased<T>(
  current: ProjectListRefresh<T>,
): ProjectListRefresh<unknown> {
  switch (current.refresh) {
    case "Reread":
      return current;
    case "RereadNamed":
      return {
        refresh: "RereadNamed",
        names: (change, previous) =>
          current.names(change, previous as T | undefined),
      };
    case "Fold":
      return {
        refresh: "Fold",
        fold: (previous, change) =>
          current.fold(previous as T | undefined, change),
      };
    case "FoldElseReread":
      return {
        refresh: "FoldElseReread",
        fold: (previous, change) =>
          current.fold(previous as T | undefined, change),
        rereads: (previous, change) =>
          current.rereads(previous as T | undefined, change),
      };
  }
}

/**
 * A list's refresh, and one for each kind alongside it, registered for as
 * long as the screen is mounted — past the registration budget too, with the
 * overrun logged, because the budget only makes a leak visible and a screen
 * that stopped drawing would be worse; a read that is no list registers
 * nothing, and needs no stream to read under.
 * `usePanelState` is the caller that matters: this is exported for the suite
 * that drives the registry with no panel under it, and a registration with no
 * query beneath it refreshes nothing.
 */
export function useProjectListRefresh<T>(
  list: ProjectList<T> | undefined,
): void {
  const wiring = useContext(ProjectStreamContext);
  if (list !== undefined && wiring === undefined)
    throw new Error("the stream was read outside the provider that holds it");
  const folds = wiring?.folds;
  const held = useRef(list);
  useEffect(() => {
    held.current = list;
  }, [list]);
  const kind = list?.kind;
  const named = list === undefined ? undefined : JSON.stringify(list.key);
  const alongside =
    list === undefined
      ? ""
      : (Object.keys(list.alongside) as ProjectChangeKind[]).sort().join(",");
  useEffect(() => {
    if (folds === undefined || kind === undefined || named === undefined)
      return;
    if (folds.size >= projectListFoldsMax)
      logWarned(
        `more than ${String(projectListFoldsMax)} list folds are registered, which is a leak`,
      );
    const key = JSON.parse(named) as ProjectQueryKey;
    const registrations: ProjectListRegistration[] = [
      {
        kind,
        key,
        refresh: () => projectListRefreshHeld(held.current?.refresh),
      },
      ...(alongside === ""
        ? []
        : (alongside.split(",") as ProjectChangeKind[])
      ).map((other): ProjectListRegistration => ({
        kind: other,
        key,
        refresh: () => projectListRefreshHeld(held.current?.alongside[other]),
      })),
    ];
    for (const registration of registrations) folds.add(registration);
    return () => {
      for (const registration of registrations) folds.delete(registration);
    };
  }, [folds, kind, named, alongside]);
}

/** A refresh the screen holds now, and one that leaves the entry as it is
 * where the screen no longer holds one for that kind. */
function projectListRefreshHeld<T>(
  refresh: ProjectListRefresh<T> | undefined,
): ProjectListRefresh<unknown> {
  return refresh === undefined
    ? { refresh: "Fold", fold: (previous) => previous }
    : projectListRefreshErased(refresh);
}
