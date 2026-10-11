/**
 * Several documents of one browser over the one store, with no browser
 * present, shared by the suites that open more than one.
 *
 * Each document is a holder of its own with a clock of its own. What they
 * share is the persistent store, the turn a renewal is taken under, and
 * whatever issuer the suite answers them with. A document is told of what the
 * others store as a browser tells it, and one that is not `told` hears
 * nothing until it is `shown`, as one kept in the back-forward cache is.
 */

import { createSessionHolder } from "../app/core/sessionHolder.ts";
import type {
  KeyValuePort,
  SessionHolder,
  SessionHolderPorts,
  SessionLocation,
} from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import { keyValueDouble } from "./keyValueDouble.ts";
import type { HeldStore } from "./keyValueDouble.ts";
import { sessionHarness } from "./sessionHolderHarness.ts";

export interface SharedDocument {
  readonly holder: SessionHolder;
  readonly clock: { nowMs: number };
  /** Where each sign-in pressed in this document sent it. */
  readonly redirects: string[];
  /** Tells the document the store may have moved, whether or not it is
   * `told`: what a browser does as it shows a kept document again. */
  readonly shown: () => void;
}

export interface SharedOpening {
  /** Whether the document hears what the others store. */
  readonly told?: boolean;
  /** Whether its renewals wait their turn behind the others'. */
  readonly turn?: boolean;
  /** The tab's own store, where the document is one a tab loaded after another. */
  readonly transient?: HeldStore;
  /** The address the document is loaded at, where it says one. */
  readonly at?: SessionLocation;
}

export interface SharedBrowser {
  readonly store: HeldStore;
  /** Every key the documents stored or removed, in the order they did. */
  readonly stored: string[];
  /** What each renewal asked its turn under, and how long it would wait. */
  readonly turns: { readonly name: string; readonly waitMs: number }[];
  /** Runs before each read a document makes of the store, where a case has
   * another process write between two of them. */
  beforeRead: (key: string) => void;
  readonly open: (options?: SharedOpening) => Promise<SharedDocument>;
}

/** Lets everything already able to run do so, and nothing held arrive. */
export async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type Turn = NonNullable<SessionHolderPorts["exclusive"]>;

/** The turn the documents renew under, one at a time in the order they asked. */
function turnTaken(turns: SharedBrowser["turns"]): Turn {
  let queue: Promise<void> = Promise.resolve();
  return (name, waitMs, body) => {
    turns.push({ name, waitMs });
    const taken = queue.then(body);
    queue = taken.then(
      () => undefined,
      () => undefined,
    );
    return taken;
  };
}

/** The store as one document writes it: `changed` is told of a change the
 * document made, and of none that changed nothing. */
function storeWritten(
  store: HeldStore,
  reading: (key: string) => void,
  changed: (key: string) => void,
): KeyValuePort {
  return {
    read: (key) => {
      reading(key);
      return store.read(key);
    },
    write: (key, value) => {
      if (store.read(key) === value) return;
      store.write(key, value);
      changed(key);
    },
    remove: (key) => {
      if (store.read(key) === null) return;
      store.remove(key);
      changed(key);
    },
  };
}

export function sharedBrowser(
  answer: (request: FormRequest | string) => unknown,
): SharedBrowser {
  const store = keyValueDouble();
  const stored: string[] = [];
  const turns: SharedBrowser["turns"] = [];
  const hearing = new Map<number, () => void>();
  const exclusive = turnTaken(turns);
  let draws = 0;
  /** The others are told of what a document stores, and the writer is not,
   * which is how a browser tells them. */
  const storeOf = (document: number): KeyValuePort =>
    storeWritten(
      store,
      (key) => {
        browser.beforeRead(key);
      },
      (key) => {
        stored.push(key);
        for (const [other, heard] of hearing) if (other !== document) heard();
      },
    );
  const browser: SharedBrowser = {
    store,
    stored,
    turns,
    beforeRead: () => undefined,
    open: async (options = {}) => {
      const document = hearing.size;
      const harness = sessionHarness();
      harness.answer = answer;
      let shown = (): void => undefined;
      const holder = createSessionHolder({
        ...harness.ports,
        persistent: storeOf(document),
        ...(options.transient === undefined
          ? {}
          : { transient: options.transient }),
        drawBytes: (count) => {
          draws += 1;
          return new Uint8Array(count).fill(draws);
        },
        ...(options.turn === false ? {} : { exclusive }),
        storedHeard: (heard) => {
          shown = heard;
          hearing.set(
            document,
            options.told === false ? () => undefined : heard,
          );
        },
      });
      await holder.load(options.at);
      return {
        holder,
        clock: harness,
        redirects: harness.redirects,
        shown: () => {
          shown();
        },
      };
    },
  };
  return browser;
}
