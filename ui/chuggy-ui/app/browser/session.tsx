/**
 * The session, handed to the tree and watched for changes.
 *
 * The holder is the authority and this is only how React reads it: a
 * subscription for the snapshot, one timer that renews the token before it
 * lapses so a long-lived stream is never carrying an expired one, and the start
 * — the load and the callback — which runs again when the first got no answer.
 *
 * The browser's holder is built here and nowhere else, over the browser's own
 * ports, so that a suite builds the one the console runs. It shares its store
 * with every other document of the origin, so it is given the turn they renew
 * under and is told when the stored session may have moved: another document
 * changed the store, or this one was shown again out of the back-forward
 * cache.
 */

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import {
  createSessionHolder,
  sessionCallbackPath,
} from "../core/sessionHolder.ts";
import type { SessionHolder, SessionSnapshot } from "../core/sessionHolder.ts";
import {
  currentLocation,
  digest,
  drawBytes,
  exclusively,
  fetchJson,
  nowMs,
  pageRestoredHeard,
  persistentChangeHeard,
  persistentStore,
  redirect,
  replacePath,
  sleepMs,
  transientStore,
} from "./ports.ts";

/** The session holder of a document in a browser. */
export function sessionHolderOpened(): SessionHolder {
  return createSessionHolder({
    nowMs,
    sleepMs,
    fetchJson,
    persistent: persistentStore,
    transient: transientStore,
    digest,
    drawBytes,
    redirect,
    exclusive: exclusively,
    storedHeard: (heard) => {
      persistentChangeHeard(heard);
      pageRestoredHeard(heard);
    },
  });
}

const SessionContext = createContext<SessionHolder | undefined>(undefined);

export function SessionProvider(props: {
  readonly holder: SessionHolder;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <SessionContext.Provider value={props.holder}>
      {props.children}
    </SessionContext.Provider>
  );
}

/**
 * Loads the session, saying where the document is so that one the redirect
 * brought back is nobody's until what it brought has answered, and completes
 * that. A refused sign-in is drawn with its reason, not as a browser holding
 * none.
 */
export async function sessionBegin(holder: SessionHolder): Promise<void> {
  const location = currentLocation();
  await holder.load(location);
  const callback = await holder.completeCallback(location);
  if (callback.result === "None") return;
  if (callback.result === "Denied") holder.refuse(callback.reason);
  replacePath(sessionCallbackPath(callback));
}

export function useSessionHolder(): SessionHolder {
  const holder = useContext(SessionContext);
  if (holder === undefined)
    throw new Error("a session was read outside the provider that holds it");
  return holder;
}

export function useSessionSnapshot(): SessionSnapshot {
  const holder = useSessionHolder();
  return useSyncExternalStore(holder.subscribe, holder.snapshot);
}

export function useSessionGeneration(): number {
  const holder = useSessionHolder();
  return useSyncExternalStore(holder.subscribe, holder.generation);
}

/**
 * One timer, rescheduled whenever the session changes, so the renewal happens
 * before expiry rather than on the first request that finds it lapsed.
 */
export function useSilentRefresh(): void {
  const holder = useSessionHolder();
  const generation = useSessionGeneration();
  useEffect(() => {
    const dueAtMs = holder.refreshDueAtMs();
    if (dueAtMs === undefined) return;
    const controller = new AbortController();
    void sleepMs(Math.max(dueAtMs - nowMs(), 0), controller.signal).then(
      () => holder.refresh(),
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [holder, generation]);
}
