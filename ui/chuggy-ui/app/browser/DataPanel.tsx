/**
 * The panel a read is drawn in: the chrome, when what it holds was observed,
 * and the three states a read is in when it is not ready, under a title that
 * already names what was not read.
 *
 * Absence and failure are drawn as themselves, in `ReadFailed`'s words — an
 * empty table that looks healthy is what this composition exists to make
 * impossible. A read that failed behind an answer keeps the answer drawn,
 * saying where its freshness would that it was not updated. It holds the
 * state and the clock so that the panel primitive holds neither.
 */

import type { ReactNode } from "react";

import type { ApiFailure } from "../core/apiRequest.ts";
import { failureWords, readFailedLead } from "../core/failureWords.ts";
import type { PanelState } from "../core/freshness.ts";
import { Freshness } from "./Freshness.tsx";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** Retry for a failed read, or nothing when the read carries no retry. */
function PanelRetry(props: {
  readonly retry: (() => void) | undefined;
}): ReactNode {
  if (props.retry === undefined) return null;
  return (
    <Button size="sm" variant="quiet" onClick={props.retry}>
      Retry
    </Button>
  );
}

/**
 * A read that did not answer, as one line: what was not read, where the place
 * names it, and the failure's word, whose detail is on hover of the word and
 * never in the line. An absence is the parked tone, since it is an answer.
 */
export function ReadFailed(props: {
  readonly subject?: string | undefined;
  readonly failure: ApiFailure;
  readonly retry?: (() => void) | undefined;
}): ReactNode {
  const words = failureWords(props.failure);
  const lead = readFailedLead(props.subject, props.failure);
  return (
    <div className="read-failed flex flex-wrap items-center gap-2">
      <Notice
        tone={props.failure.outcome === "Absent" ? "parked" : "danger"}
        inline
      >
        {lead.map((part) => `${part} · `).join("")}
        <Tooltip text={words.detail}>
          <span>{words.word}</span>
        </Tooltip>
      </Notice>
      <PanelRetry retry={props.retry} />
    </div>
  );
}

/**
 * A read that is not ready, as the one line it is drawn as. Said here once
 * because a panel is not the only place a read is waited on: a part of a ready
 * panel may be waiting on a read of its own, and it says so in these words.
 */
export function PanelUnready<T>(props: {
  readonly state: PanelState<T>;
}): ReactNode {
  const state = props.state;
  switch (state.state) {
    case "Pending":
      return <Notice tone="info" inline detail="Loading…" />;
    case "Absent":
      return <ReadFailed failure={{ outcome: "Absent" }} />;
    case "Failed":
      return <ReadFailed failure={state.failure} retry={state.retry} />;
    case "Ready":
      return null;
  }
}

/** When a ready read was observed, or that its last read failed and it was not
 * updated. */
function PanelFreshness(props: {
  readonly observedAtMs: number | undefined;
  readonly rereadFailed: boolean | undefined;
  readonly retry: (() => void) | undefined;
}): ReactNode {
  if (props.rereadFailed !== true)
    return <Freshness observedAtMs={props.observedAtMs} />;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="freshness freshness-stale">Not updated</span>
      <PanelRetry retry={props.retry} />
    </span>
  );
}

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
          <PanelFreshness
            observedAtMs={state.observedAtMs}
            rereadFailed={state.rereadFailed}
            retry={state.retry}
          />
        ) : undefined
      }
    >
      <PanelUnready state={state} />
      {state.state === "Ready" ? props.children(state.value) : null}
    </Panel>
  );
}

/**
 * A read's not-ready states and, once ready, its freshness and its value —
 * with no title of its own, for a body whose heading is the accordion row it
 * opens under.
 */
export function DataSection<T>(props: {
  readonly state: PanelState<T>;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const state = props.state;
  return (
    <div className="grid gap-3">
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <>
          <div className="flex justify-end">
            <PanelFreshness
              observedAtMs={state.observedAtMs}
              rereadFailed={state.rereadFailed}
              retry={state.retry}
            />
          </div>
          {props.children(state.value)}
        </>
      ) : null}
    </div>
  );
}
