/**
 * The decision log: what the lead decided, newest first, each group holding the
 * tickets it dispatched, refused and lifted.
 *
 * The log has no change kind of its own, so it is re-read on the partition
 * invalidation the stream's fallback already performs; what a decision saw is
 * not drawn here, because the observation is a page of candidates and this is
 * the record of what was done with it.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  SelectorDecisionResponse,
  SelectorHistoryResponse,
} from "../../../../../src/contract/responses.ts";
import { apiSelectorHistory } from "../../core/apiRoutes.ts";
import {
  costFigure,
  durationFigure,
  instantFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import { leadDecisionSummary } from "../../core/leadTranscript.ts";
import type { Tone } from "../../core/tones.ts";
import { usePanelResource } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Ledger, LedgerBlock, LedgerGroup, LedgerRow } from "../ui/Ledger.tsx";

/** Neither a kind nor a resource a frame carries, so the partition's own
 * refetch is what reaches it. */
export const leadDecisionsResource = "selector-history";

/** What one decision cost and how long it took, as the group's own roll-up. */
function LeadDecisionRollup(props: {
  readonly decision: SelectorDecisionResponse;
}): ReactNode {
  const decision = props.decision;
  return (
    <>
      <Figure
        figure={
          decision.costMicros === undefined
            ? { kind: "Absent", why: "No cost measured" }
            : costFigure(decision.costMicros, "List")
        }
      />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure
        figure={
          decision.tokens === undefined
            ? { kind: "Absent", why: "No tokens measured" }
            : tokenCountFigure(decision.tokens)
        }
      />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure
        figure={
          decision.durationMs === undefined
            ? { kind: "Absent", why: "No duration measured" }
            : durationFigure(decision.durationMs)
        }
      />
    </>
  );
}

interface LeadDecisionArm {
  readonly label: string;
  readonly tickets: readonly number[];
  readonly tone: Tone;
  readonly word: string;
}

function leadDecisionArms(
  decision: SelectorDecisionResponse,
): readonly LeadDecisionArm[] {
  return [
    {
      label: "Dispatched",
      tickets: decision.dispatched,
      tone: "pass",
      word: "Queued",
    },
    {
      label: "Refused",
      tickets: decision.refused,
      tone: "fail",
      word: "Refused",
    },
    {
      label: "Lifted",
      tickets: decision.lifted,
      tone: "retired",
      word: "Lifted",
    },
  ];
}

function LeadDecisionGroup(props: {
  readonly decision: SelectorDecisionResponse;
  readonly current: boolean;
  readonly nowMs: number;
}): ReactNode {
  const decision = props.decision;
  const arms = leadDecisionArms(decision).filter(
    (arm) => arm.tickets.length > 0,
  );
  return (
    <LedgerGroup
      title={`Decision ${String(decision.ordinal)}`}
      standing={props.current ? "Current" : "Superseded"}
      summary={leadDecisionSummary(decision)}
      rollup={<LeadDecisionRollup decision={decision} />}
      open={props.current}
    >
      <LedgerBlock eyebrow={decision.decision}>
        {arms.length === 0 ? (
          <LedgerRow
            label="Tickets"
            pill={{ tone: "retired", text: "None" }}
            ghost
            when={instantFigure(decision.completedAt, props.nowMs)}
          />
        ) : (
          arms.map((arm) => (
            <LedgerRow
              key={arm.label}
              label={arm.label}
              pill={{ tone: arm.tone, text: arm.word }}
              when={instantFigure(decision.completedAt, props.nowMs)}
              note={arm.tickets.map((ticket) => String(ticket)).join(", ")}
            />
          ))
        )}
      </LedgerBlock>
    </LedgerGroup>
  );
}

function LeadDecisionList(props: {
  readonly history: SelectorHistoryResponse;
  readonly nowMs: number;
}): ReactNode {
  const decisions = [...props.history.decisions].reverse();
  const newest = decisions[0]?.ordinal;
  if (decisions.length === 0) return <EmptyState label="No decisions" />;
  return (
    <Ledger>
      {decisions.map((decision) => (
        <LeadDecisionGroup
          key={decision.decision}
          decision={decision}
          current={decision.ordinal === newest}
          nowMs={props.nowMs}
        />
      ))}
    </Ledger>
  );
}

export function LeadDecisions(props: {
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelResource(
    partition,
    "Session",
    leadDecisionsResource,
    (ports) => apiSelectorHistory(ports, partition),
  );
  return (
    <DataPanel title="Decisions" state={state}>
      {(history) => <LeadDecisionList history={history} nowMs={props.nowMs} />}
    </DataPanel>
  );
}
