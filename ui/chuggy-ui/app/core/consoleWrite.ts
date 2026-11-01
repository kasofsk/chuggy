/**
 * A console write: one mutation per press, under a key of its own, whose
 * refusal is one typed failure carrying the sentence a screen draws for it.
 *
 * A WRITE IS SENT ONCE. Its key is the idempotency key the press drew, and a
 * write the console cannot tell landed is one it must not send again, so the
 * cache's mutations never retry on their own.
 *
 * A REFUSAL NOBODY IS WATCHING IS KEPT TO BE SHOWN. A screen showing a write
 * says it is watching that write's key for as long as it is mounted, and draws
 * the refusal itself; one that lands under a key nothing watches — the screen
 * that asked was left — is held here until the shell has shown it and the
 * reader has let it go.
 */

import { MutationCache, QueryClient, hashKey } from "@tanstack/query-core";
import type { MutationKey } from "@tanstack/query-core";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
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
}

/** The refusals held for the shell at most, the oldest let go first. */
export const consoleWriteUnseenMax = 3;

/** Which write keys a mounted screen is showing, and the refusals that landed
 * under none of them. */
export class ConsoleWriteWatch {
  readonly #watching = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  #unseen: readonly ConsoleWriteUnseen[] = [];
  #drawn = 0;

  /** Watching `key` until the release this answers is called. */
  watched(key: MutationKey): () => void {
    const hashed = hashKey(key);
    this.#watching.set(hashed, (this.#watching.get(hashed) ?? 0) + 1);
    return () => {
      const left = (this.#watching.get(hashed) ?? 1) - 1;
      if (left > 0) this.#watching.set(hashed, left);
      else this.#watching.delete(hashed);
    };
  }

  /** A write under `key` was refused: kept for the shell where nothing
   * mounted is showing that key. */
  refused(key: MutationKey | undefined, sentence: string): void {
    if (key !== undefined && this.#watching.has(hashKey(key))) return;
    this.#drawn += 1;
    this.#unseen = [...this.#unseen, { id: this.#drawn, sentence }].slice(
      -consoleWriteUnseenMax,
    );
    this.#told();
  }

  get unseen(): readonly ConsoleWriteUnseen[] {
    return this.#unseen;
  }

  dismissed(id: number): void {
    this.#unseen = this.#unseen.filter((unseen) => unseen.id !== id);
    this.#told();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #told(): void {
    for (const listener of this.#listeners) listener();
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
 * once, and a refusal handed to the watch of the client it landed in. */
export function consoleQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation, { client }) => {
        consoleWriteWatchOf(client).refused(
          mutation.options.mutationKey,
          consoleWriteRefusedOf(error).message,
        );
      },
    }),
    defaultOptions: {
      queries: panelQueryDefaults,
      mutations: consoleMutationDefaults,
    },
  });
}
