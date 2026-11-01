/**
 * A console write: one mutation per press, under a key of its own, whose
 * refusal is one typed failure carrying the sentence a screen draws for it.
 *
 * A WRITE IS SENT ONCE. Its key is the idempotency key the press drew, and a
 * write the console cannot tell landed is one it must not send again, so the
 * cache's mutations never retry on their own.
 *
 * A REFUSAL NOBODY DRAWS IS KEPT TO BE SHOWN. A mounted screen watches its
 * write's key, and is asked, as each refusal under it lands, whether it draws
 * that refusal where it stands now; one no screen draws — the screen that
 * asked was left, or stands where the refusal is not drawn — is handed to the
 * client's store, which holds it until the shell has shown it and the reader
 * has let it go.
 */

import {
  MutationCache,
  QueryClient,
  hashKey,
  notifyManager,
} from "@tanstack/query-core";
import type { MutationKey } from "@tanstack/query-core";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";
import { panelQueryDefaults } from "./panelQueryDefaults.ts";

/** What a write the API or the console refused threw: the sentence its screen
 * draws, and the outcome the contract classified where the API answered. */
export class ConsoleWriteRefused extends Error {
  readonly failure: ApiFailure | undefined;

  constructor(sentence: string, failure?: ApiFailure) {
    super(sentence);
    this.name = "ConsoleWriteRefused";
    this.failure = failure;
  }
}

/** What a refusal carries beyond its sentence, for a reader reporting it: the
 * detail of the outcome the API answered, where it answered. */
export function consoleWriteRefusedDetail(
  refused: ConsoleWriteRefused,
): string | undefined {
  return refused.failure === undefined
    ? undefined
    : failureWords(refused.failure).detail;
}

/** The value a write answered, or its refusal thrown in its screen's words. */
export function consoleWriteAnswered<T>(
  result: ApiResult<T>,
  refusal: (failure: ApiFailure) => string,
): T {
  if (result.outcome === "Ok") return result.value;
  throw new ConsoleWriteRefused(refusal(result), result);
}

/** A throw that was no refusal, as one: the request or the wait threw rather
 * than answered, and a screen told nothing is a screen that stays busy. */
export function consoleWriteRefusedOf(thrown: unknown): ConsoleWriteRefused {
  if (thrown instanceof ConsoleWriteRefused) return thrown;
  return new ConsoleWriteRefused(
    thrown instanceof Error ? thrown.message : "the request failed",
  );
}

/** One write's key: what it writes and the scope it writes under. */
export function consoleWriteKey(
  ...named: readonly (string | number)[]
): MutationKey {
  return ["write", ...named];
}

/**
 * One write: its key, the request, the sentence its refusal is drawn as, what
 * it changed, and what a refusal leaves behind. The write is not over until
 * `landed` has answered, so a button stays busy until the reads it changed have
 * been read again; both run whether or not the screen that pressed is mounted.
 */
export interface ConsoleWrite<V, T> {
  readonly mutationKey: MutationKey;
  readonly write: (
    ports: ApiPorts,
    variables: V,
    client: QueryClient,
  ) => Promise<ApiResult<T>>;
  readonly refusal: (failure: ApiFailure) => string;
  readonly landed?: (
    client: QueryClient,
    value: T,
    variables: V,
  ) => Promise<unknown>;
  readonly refused?: (error: ConsoleWriteRefused, variables: V) => void;
}

export const consoleMutationDefaults = { retry: 0 } as const;

/**
 * Where a write that reports its steps reports them, carried in the write's
 * variables so a screen that mounts while it runs reads the step it is at.
 */
export class ConsoleWriteProgress<S> {
  #step: S | undefined = undefined;
  readonly #listeners = new Set<() => void>();

  get step(): S | undefined {
    return this.#step;
  }

  report(step: S): void {
    this.#step = step;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

/** A refusal no screen took, as the shell draws it. */
export interface ConsoleWriteUnseen {
  readonly id: number;
  readonly sentence: string;
  readonly detail: string | undefined;
}

/** The refusals no screen took, and how many have been kept, which names the
 * next one. */
export interface ConsoleWriteUnseenHeld {
  readonly kept: number;
  readonly unseen: readonly ConsoleWriteUnseen[];
}

/** The refusals held for the shell at most, the oldest let go first. */
export const consoleWriteUnseenMax = 3;

export const consoleWriteUnseenHeldEmpty: ConsoleWriteUnseenHeld = {
  kept: 0,
  unseen: [],
};

/** What the shell draws of a refusal, before it is named. */
export type ConsoleWriteUnseenSaid = Omit<ConsoleWriteUnseen, "id">;

export function consoleWriteUnseenSaidOf(
  refused: ConsoleWriteRefused,
): ConsoleWriteUnseenSaid {
  return {
    sentence: refused.message,
    detail: consoleWriteRefusedDetail(refused),
  };
}

/** The refusals once `said` is kept, named one past the last kept. */
export function consoleWriteUnseenKept(
  held: ConsoleWriteUnseenHeld,
  said: ConsoleWriteUnseenSaid,
): ConsoleWriteUnseenHeld {
  const kept = held.kept + 1;
  return {
    kept,
    unseen: [...held.unseen, { id: kept, ...said }].slice(
      -consoleWriteUnseenMax,
    ),
  };
}

/** The refusals once the reader let `id` go. */
export function consoleWriteUnseenDismissed(
  held: ConsoleWriteUnseenHeld,
  id: number,
): ConsoleWriteUnseenHeld {
  return {
    ...held,
    unseen: held.unseen.filter((unseen) => unseen.id !== id),
  };
}

/** Whether a screen draws a refusal under its key, asked as the refusal lands
 * with the variables its write was sent with. */
export type ConsoleWriteDrawn = (
  refused: ConsoleWriteRefused,
  variables: unknown,
) => boolean;

/** Which write keys mounted screens watch, and who hears a refusal that
 * landed where none of them draws it. */
export class ConsoleWriteWatch {
  readonly #watching = new Map<string, Set<ConsoleWriteDrawn>>();
  #unseen: ((refused: ConsoleWriteRefused) => void) | undefined = undefined;

  /** Watching `key`, asking `drawn` of each refusal under it, until the
   * release this answers is called. */
  watched(key: MutationKey, drawn: ConsoleWriteDrawn): () => void {
    const hashed = hashKey(key);
    const watchers = this.#watching.get(hashed) ?? new Set();
    const watcher: ConsoleWriteDrawn = (refused, variables) =>
      drawn(refused, variables);
    watchers.add(watcher);
    this.#watching.set(hashed, watchers);
    return () => {
      watchers.delete(watcher);
      if (watchers.size === 0) this.#watching.delete(hashed);
    };
  }

  /** Who hears each refusal no watching screen draws, in place of any before
   * it; with nobody, such a refusal is let go. */
  unseenHeard(heard: (refused: ConsoleWriteRefused) => void): void {
    this.#unseen = heard;
  }

  /** A write under `key` was refused: handed on where no screen watching that
   * key draws it. */
  refused(
    key: MutationKey | undefined,
    refused: ConsoleWriteRefused,
    variables: unknown,
  ): void {
    const watchers =
      key === undefined ? undefined : this.#watching.get(hashKey(key));
    if ([...(watchers ?? [])].some((drawn) => drawn(refused, variables)))
      return;
    this.#unseen?.(refused);
  }
}

const consoleWriteWatches = new WeakMap<QueryClient, ConsoleWriteWatch>();

/** The one watch of a client's writes, made the first time it is asked for. */
export function consoleWriteWatchOf(client: QueryClient): ConsoleWriteWatch {
  const standing = consoleWriteWatches.get(client);
  if (standing !== undefined) return standing;
  const watch = new ConsoleWriteWatch();
  consoleWriteWatches.set(client, watch);
  return watch;
}

/** The console's cache: reads kept as `panelQueryDefaults` says, writes sent
 * once, and a refusal handed to the watch of the client it landed in once
 * what the cache told its readers before it has been told, so a screen is
 * asked of what it drew of a reread the write awaited. */
export function consoleQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, variables, _context, mutation, { client }) => {
        notifyManager.schedule(() => {
          consoleWriteWatchOf(client).refused(
            mutation.options.mutationKey,
            consoleWriteRefusedOf(error),
            variables,
          );
        });
      },
    }),
    defaultOptions: {
      queries: panelQueryDefaults,
      mutations: consoleMutationDefaults,
    },
  });
}
