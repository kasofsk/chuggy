/**
 * The one way a screen writes: `useConsoleWrite` over a mutation, the words a
 * refusal is drawn in, and the toast that draws one whose screen was left.
 *
 * A WRITE OUTLIVES ITS SCREEN. Nothing aborts it on unmount, and a screen that
 * mounts while one is in flight under its key takes it up and draws it as its
 * own, pending and then answered.
 *
 * A SCREEN SAYS WHERE IT DRAWS A REFUSAL. Being mounted is not drawing: a
 * closed dialog, or a form holding other names than the write was sent with,
 * draws none, and a refusal there is the shell's toast.
 */

import {
  hashKey,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  MutationKey,
  MutationStatus,
  UseMutateFunction,
} from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  consoleWriteAnswered,
  consoleWriteRefusedDetail,
  consoleWriteRefusedOf,
  consoleWriteWatchOf,
} from "../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteProgress,
  ConsoleWriteRefused,
} from "../core/consoleWrite.ts";
import { useApiPorts } from "./api.ts";
import {
  consoleWriteUnseenLetGo,
  consoleWriteUnseenOf,
} from "./consoleWriteUnseen.ts";
import { useConsoleDispatch, useConsoleSelector } from "./store.ts";
import { Toasts } from "./ui/Toast.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** What a screen draws of its write, and the press that makes one. What a
 * press asks to be told is told only while the screen that pressed is mounted. */
export interface ConsoleWriting<V, T> {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly error: ConsoleWriteRefused | null;
  readonly data: T | undefined;
  readonly variables: V | undefined;
  /** Whether what is drawn is a write this mount took up rather than pressed,
   * so that what its press asked to be told is told to nobody. */
  readonly takenUp: boolean;
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

/** Whether a screen draws its write's refusal where it stands now, or of a
 * refusal of the variables its write was sent with; asked as the screen last
 * rendered it, when the refusal lands. */
export interface ConsoleWriteShown<V> {
  readonly drawn:
    boolean | ((refused: ConsoleWriteRefused, variables: V) => boolean);
}

/** The key watched while the screen is mounted, asking `drawn` as the screen
 * last rendered it. */
function useConsoleWriteWatched<V>(
  key: MutationKey,
  drawn: ConsoleWriteShown<V>["drawn"],
): void {
  const client = useQueryClient();
  const keyed = hashKey(key);
  const latest = useRef(drawn);
  useEffect(() => {
    latest.current = drawn;
  });
  useEffect(
    () =>
      consoleWriteWatchOf(client).watched(key, (refused, variables) => {
        const standing = latest.current;
        return typeof standing === "boolean"
          ? standing
          : standing(refused, variables as V);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is watched by its hash, which a fresh array of the same parts keeps
    [client, keyed],
  );
}

/**
 * One write, sent once per press and never again on its own. Its refusal is
 * `error`, in the sentence the write names; it is pending until what it
 * changed has been read again; and a refusal under its key that `shown.drawn`
 * says this screen draws is the screen's and not the shell's.
 */
export function useConsoleWrite<V, T>(
  write: ConsoleWrite<V, T>,
  shown: ConsoleWriteShown<V>,
): ConsoleWriting<V, T> {
  const ports = useApiPorts();
  const client = useQueryClient();
  useConsoleWriteWatched(write.mutationKey, shown.drawn);
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
    onError: (error, variables) => {
      write.refused?.(error, variables);
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
      takenUp: false,
      mutate: own.mutate,
      reset,
    };
  return {
    isPending: standing.status === "pending",
    isSuccess: standing.status === "success",
    error: standing.error,
    data: standing.data,
    variables: standing.variables,
    takenUp: true,
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
  const dispatch = useConsoleDispatch();
  const unseen = useConsoleSelector(consoleWriteUnseenOf);
  return (
    <Toasts
      toasts={unseen.map((refused) => ({
        id: refused.id,
        line: refused.sentence,
        detail: refused.detail,
      }))}
      onDismiss={(id) => {
        dispatch(consoleWriteUnseenLetGo(id));
      }}
    />
  );
}

/** A refused write's sentence, with what its failure carries beyond it on
 * hover of the sentence and never in it. */
export function ConsoleWriteRefusedWords(props: {
  readonly refused: ConsoleWriteRefused;
  readonly className?: string;
}): ReactNode {
  return (
    <Tooltip text={consoleWriteRefusedDetail(props.refused)}>
      <span className={props.className}>{props.refused.message}</span>
    </Tooltip>
  );
}
