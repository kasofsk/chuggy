/**
 * The one panel every screen draws its data in, and the clock its header reads.
 *
 * A panel always says when what it shows was last observed, and absence and
 * failure are drawn as themselves with the reason — an empty table that looks
 * healthy is the thing this component exists to make impossible.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { freshnessIsStale, freshnessLabel } from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import { nowMs } from "./ports.ts";

export const freshnessTickMs = 5_000;

/** One interval per panel, so the label ages without the data being reread. */
export function useNowMs(): number {
  const [observed, setObserved] = useState<number>(() => nowMs());
  useEffect(() => {
    const tick = setInterval(() => {
      setObserved(nowMs());
    }, freshnessTickMs);
    return () => {
      clearInterval(tick);
    };
  }, []);
  return observed;
}

export function Freshness(props: {
  readonly observedAtMs: number | undefined;
}): ReactNode {
  const now = useNowMs();
  const stale = freshnessIsStale(now, props.observedAtMs);
  return (
    <span className={stale ? "freshness freshness-stale" : "freshness"}>
      {freshnessLabel(now, props.observedAtMs)}
    </span>
  );
}

export function Panel<T>(props: {
  readonly title: string;
  readonly state: PanelState<T>;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const state = props.state;
  const observedAtMs = state.state === "Ready" ? state.observedAtMs : undefined;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{props.title}</h2>
        {state.state === "Ready" ? (
          <Freshness observedAtMs={observedAtMs} />
        ) : null}
      </header>
      {state.state === "Pending" ? (
        <p className="panel-note">reading…</p>
      ) : null}
      {state.state === "Absent" ? (
        <p className="panel-absent">not here — {state.reason}</p>
      ) : null}
      {state.state === "Failed" ? (
        <p className="panel-failed">could not be read — {state.reason}</p>
      ) : null}
      {state.state === "Ready" ? props.children(state.value) : null}
    </section>
  );
}
