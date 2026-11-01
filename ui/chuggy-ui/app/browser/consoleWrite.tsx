/**
 * The one way a screen writes: `useConsoleWrite` over a mutation, and the toast
 * that draws a refusal whose screen was left.
 *
 * A WRITE OUTLIVES ITS SCREEN. Nothing aborts it on unmount, and a screen that
 * mounts while one is in flight under its key takes it up and draws it as its
 * own, pending and then answered.
 */

import {
  hashKey,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationStatus, UseMutateFunction } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  consoleWriteAnswered,
  consoleWriteRefusedOf,
  consoleWriteWatchOf,
} from "../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteProgress,
  ConsoleWriteRefused,
} from "../core/consoleWrite.ts";
import { useApiPorts } from "./api.ts";
import { Toasts } from "./ui/Toast.tsx";

/** What a screen draws of its write, and the press that makes one. What a
 * press asks to be told is told only while the screen that pressed is mounted. */
export interface ConsoleWriting<V, T> {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly error: ConsoleWriteRefused | null;
  readonly data: T | undefined;
  readonly variables: V | undefined;
  readonly mutate: UseMutateFunction<T, ConsoleWriteRefused, V>;
  readonly reset: () => void;
}

interface ConsoleWriteStanding<V, T> {
  readonly id: number;
  readonly status: MutationStatus;
  readonly error: ConsoleWriteRefused | null;
  readonly data: T | undefined;
  readonly variables: V | undefined;
}

/**
 * The latest write under `key` that this mount saw in flight, which is the one
 * a remounted screen draws until it makes one of its own. Only one seen
 * pending is taken up, so an answer that landed before the screen came back is
 * not drawn a second time.
 */
function useConsoleWriteTakenUp<V, T>(
  write: ConsoleWrite<V, T>,
  idle: boolean,
): {
  readonly standing: ConsoleWriteStanding<V, T> | undefined;
  readonly dropped: () => void;
} {
  const standings = useMutationState({
    filters: { mutationKey: write.mutationKey, exact: true },
    select: (mutation): ConsoleWriteStanding<V, T> => ({
      id: mutation.mutationId,
      status: mutation.state.status,
      error: mutation.state.error as ConsoleWriteRefused | null,
      data: mutation.state.data as T | undefined,
      variables: mutation.state.variables as V | undefined,
    }),
  });
  const latest = standings.at(-1);
  const [taken, setTaken] = useState<number | undefined>(undefined);
  if (idle && latest?.status === "pending" && taken !== latest.id)
    setTaken(latest.id);
  return {
    standing: idle && latest?.id === taken ? latest : undefined,
    dropped: () => {
      setTaken(undefined);
    },
  };
}

/**
 * One write, sent once per press and never again on its own. Its refusal is
 * `error`, in the sentence the write names; it is pending until what it
 * changed has been read again; and for as long as the screen is mounted a
 * refusal under its key is the screen's to draw and not the shell's.
 */
export function useConsoleWrite<V, T>(
  write: ConsoleWrite<V, T>,
): ConsoleWriting<V, T> {
  const ports = useApiPorts();
  const client = useQueryClient();
  const keyed = hashKey(write.mutationKey);
  useEffect(
    () => consoleWriteWatchOf(client).watched(write.mutationKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is watched by its hash, which a fresh array of the same parts keeps
    [client, keyed],
  );
  const own = useMutation<T, ConsoleWriteRefused, V>({
    mutationKey: write.mutationKey,
    mutationFn: async (variables) => {
      try {
        return consoleWriteAnswered(
          await write.write(ports, variables, client),
          write.refusal,
        );
      } catch (thrown: unknown) {
        throw consoleWriteRefusedOf(thrown);
      }
    },
    onSuccess: async (value, variables) => {
      await write.landed?.(client, value, variables);
    },
  });
  const takenUp = useConsoleWriteTakenUp(write, own.isIdle);
  const reset = (): void => {
    own.reset();
    takenUp.dropped();
  };
  const standing = takenUp.standing;
  if (standing === undefined)
    return {
      isPending: own.isPending,
      isSuccess: own.isSuccess,
      error: own.error,
      data: own.data,
      variables: own.variables,
      mutate: own.mutate,
      reset,
    };
  return {
    isPending: standing.status === "pending",
    isSuccess: standing.status === "success",
    error: standing.error,
    data: standing.data,
    variables: standing.variables,
    mutate: own.mutate,
    reset,
  };
}

/** The step a write reports, drawn as it arrives. */
export function useConsoleWriteProgress<S>(
  progress: ConsoleWriteProgress<S> | undefined,
): S | undefined {
  return useSyncExternalStore(
    (changed) => progress?.subscribe(changed) ?? (() => undefined),
    () => progress?.step,
  );
}

/** The refusals no mounted screen took, drawn once for the whole console. */
export function ConsoleWriteToasts(): ReactNode {
  const watch = consoleWriteWatchOf(useQueryClient());
  const unseen = useSyncExternalStore(
    (changed) => watch.subscribe(changed),
    () => watch.unseen,
  );
  return (
    <Toasts
      toasts={unseen.map((refused) => ({
        id: refused.id,
        line: refused.sentence,
      }))}
      onDismiss={(id) => {
        watch.dismissed(id);
      }}
    />
  );
}
