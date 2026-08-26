/**
 * The session, handed to the tree and watched for changes.
 *
 * The holder is the authority and this is only how React reads it: a
 * subscription for the snapshot, and one timer that renews the token before it
 * lapses so a long-lived stream is never carrying an expired one.
 */

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import type { SessionHolder, SessionSnapshot } from "../core/sessionHolder.ts";
import { nowMs, sleepMs } from "./ports.ts";

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
