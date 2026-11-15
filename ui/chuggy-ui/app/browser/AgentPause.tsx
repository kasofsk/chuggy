/**
 * One pause of the reader's own agent, or of one credential of it, as a line:
 * the status, each reason and the instant it ends in the reader's own zone,
 * then whatever its caller offers beside it, each a `LinePart`.
 */

import type { ReactNode } from "react";

import type { AgentPause as AgentPauseValue } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { agentPauseParts } from "../core/agentAccounts.ts";
import { instantFigure } from "../core/figures.ts";
import { Figure } from "./ui/Figure.tsx";
import { LinePart } from "./ui/LinePart.tsx";
import { Notice } from "./ui/Notice.tsx";

export function AgentPause(props: {
  readonly pause: AgentPauseValue;
  readonly nowMs: number;
  /** What is paused, an agent or a credential, named in front where the line is not under its name. */
  readonly named?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const parts = agentPauseParts(props.pause).map((part) => text(part));
  const lead = props.named === undefined ? parts : [props.named, ...parts];
  return (
    <Notice tone="parked" inline>
      {lead.map((part, index) => (
        <LinePart key={part} first={index === 0}>
          {part}
        </LinePart>
      ))}
      <span className="text-ink-3">
        <LinePart>
          {`${text({ id: "usage-until" })} `}
          <Figure figure={instantFigure(props.pause.until, props.nowMs)} />
        </LinePart>
        {props.children}
      </span>
    </Notice>
  );
}
