/**
 * The clock a panel's header reads, and the label it draws from it.
 *
 * One interval per panel, so a label ages without the data behind it being
 * read again. It is a composition rather than a primitive because it reaches
 * the clock port, which is the whole of what `ui/` may not do.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { instantExactText } from "../core/figures.ts";
import { freshnessIsStale, freshnessLabel } from "../core/freshness.ts";
import { nowMs } from "./ports.ts";
import { Tooltip } from "./ui/Tooltip.tsx";

export const freshnessTickMs = 5_000;

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

const freshnessInstantsContext = createContext(false);

/** A page that reads every instant relative has its panels' stamps hover the
 * instant too; every other page draws them as it always has. */
export function FreshnessInstants(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <freshnessInstantsContext.Provider value={true}>
      {props.children}
    </freshnessInstantsContext.Provider>
  );
}

export function Freshness(props: {
  readonly observedAtMs: number | undefined;
}): ReactNode {
  const now = useNowMs();
  const hovered = useContext(freshnessInstantsContext);
  const stale = freshnessIsStale(now, props.observedAtMs);
  const label = (
    <span className={stale ? "freshness freshness-stale" : "freshness"}>
      {freshnessLabel(now, props.observedAtMs)}
    </span>
  );
  if (!hovered || props.observedAtMs === undefined) return label;
  return (
    <Tooltip text={instantExactText(new Date(props.observedAtMs))}>
      {label}
    </Tooltip>
  );
}
