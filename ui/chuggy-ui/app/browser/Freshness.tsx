/**
 * The clock a panel's header reads, and the label it draws from it.
 *
 * One interval per panel, so a label ages without the data behind it being
 * read again. It is a composition rather than a primitive because it reaches
 * the clock port, which is the whole of what `ui/` may not do.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { freshnessIsStale, freshnessLabel } from "../core/freshness.ts";
import { nowMs } from "./ports.ts";

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
