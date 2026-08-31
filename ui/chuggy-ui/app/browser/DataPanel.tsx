/**
 * The panel a read is drawn in: the chrome, when what it holds was observed,
 * and the three states a read is in when it is not ready.
 *
 * Absence and failure are drawn as themselves with the reason — an empty table
 * that looks healthy is what this composition exists to make impossible. It
 * holds the state and the clock so that the panel primitive holds neither.
 */

import type { ReactNode } from "react";

import type { PanelState } from "../core/freshness.ts";
import { Freshness } from "./Freshness.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";

export function DataPanel<T>(props: {
  readonly title: string;
  readonly state: PanelState<T>;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const state = props.state;
  return (
    <Panel
      title={props.title}
      meta={
        state.state === "Ready" ? (
          <Freshness observedAtMs={state.observedAtMs} />
        ) : undefined
      }
    >
      {state.state === "Pending" ? (
        <Notice tone="info" inline detail="Loading…" />
      ) : null}
      {state.state === "Absent" ? (
        <Notice
          tone="parked"
          inline
          detail={`Not available · ${state.reason}`}
        />
      ) : null}
      {state.state === "Failed" ? (
        <Notice
          tone="danger"
          inline
          detail={`Failed to load · ${state.reason}`}
        />
      ) : null}
      {state.state === "Ready" ? props.children(state.value) : null}
    </Panel>
  );
}
