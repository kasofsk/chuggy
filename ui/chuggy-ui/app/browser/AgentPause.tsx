/**
 * One pause of the reader's own agent as a line: the status, each reason and
 * the instant it ends in the reader's own zone, then whatever its caller
 * offers beside it.
 */

import type { ReactNode } from "react";

import type { AgentPause as AgentPauseValue } from "../../../../src/contract/responses.ts";
import { agentPauseLine } from "../core/agentAccounts.ts";
import { instantFigure } from "../core/figures.ts";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";

export function AgentPause(props: {
  readonly pause: AgentPauseValue;
  readonly nowMs: number;
  /** Who is paused, named in front where the line is not under their name. */
  readonly named?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const line = agentPauseLine(props.pause);
  return (
    <Notice
      tone="parked"
      inline
      detail={props.named === undefined ? line : `${props.named} · ${line}`}
    >
      <span className="text-ink-3">
        {" · until "}
        <Figure figure={instantFigure(props.pause.until, props.nowMs)} />
        {props.children}
      </span>
    </Notice>
  );
}
