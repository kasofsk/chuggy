/**
 * The run the ticket is on now: its stage, which run it is and how long it has
 * been going.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { sinceFigure } from "../../core/figures.ts";
import type { RunningNow } from "../../core/ticketSituation.ts";
import { Figure } from "../ui/Figure.tsx";

export function TicketNow(props: {
  readonly partition: PartitionIdentity;
  readonly running: RunningNow;
  readonly nowMs: number;
}): ReactNode {
  const execution = props.running.execution;
  return (
    <section className="ticket-card" aria-label="Now">
      <div className="flex items-baseline gap-3">
        <span className="eyebrow text-tone-live">Now</span>
        <span className="text-ink-2 grow">
          {props.running.stage} · {props.running.run}
        </span>
        <Figure
          figure={sinceFigure(
            execution.startedAt ?? execution.registeredAt,
            props.nowMs,
            "started",
          )}
        />
      </div>
    </section>
  );
}
