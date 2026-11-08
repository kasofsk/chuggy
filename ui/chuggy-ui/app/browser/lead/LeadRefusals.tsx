/**
 * What the lead is declining to dispatch: one row per ticket whose latest
 * refusal entry still stands, with the authoring version it was made against.
 *
 * The rows fold over the `AgenticRefusal` kind by re-reading rather than by
 * folding the frame: the frame carries one ticket's ledger, while a row here
 * carries the supersession this list decides against the ticket's current
 * authoring version.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  AgenticRefusalResponse,
  AgenticRefusalsResponse,
} from "../../../../../src/contract/responses.ts";
import { instantFigure } from "../../core/figures.ts";
import {
  agenticRefusalStanding,
  agenticRefusalStandingLabel,
} from "../../core/leadTranscript.ts";
import { agenticRefusalsQuery } from "../../core/sessionQueries.ts";
import { agenticRefusalStandingTone } from "../../core/tones.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { usePanelState } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";

function LeadRefusalRow(props: {
  readonly refusal: AgenticRefusalResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const refusal = props.refusal;
  const standing = agenticRefusalStanding(refusal);
  return (
    <tr>
      <td className="num">{refusal.ticket}</td>
      <td className="num">{refusal.ticketVersion}</td>
      <td>
        <Pill tone={agenticRefusalStandingTone(standing)}>
          {text(agenticRefusalStandingLabel(standing))}
        </Pill>
      </td>
      <td>
        <Figure figure={instantFigure(refusal.recordedAt, props.nowMs)} />
      </td>
      <td className="max-w-measure">{refusal.reason}</td>
    </tr>
  );
}

function LeadRefusalTable(props: {
  readonly refusals: AgenticRefusalsResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  if (props.refusals.refusals.length === 0)
    return <EmptyState label={text({ id: "lead-refusals-none" })} />;
  return (
    <>
      {props.refusals.more ? (
        <p className="text-ink-3">
          <span className="eyebrow">{text({ id: "lead-refusals-more" })}</span>
        </p>
      ) : null}
      <Table caption={text({ id: "lead-refusals-caption" })}>
        <thead>
          <tr>
            <th scope="col">{text({ id: "lead-refusals-col-ticket" })}</th>
            <th scope="col">{text({ id: "lead-refusals-col-version" })}</th>
            <th scope="col">{text({ id: "lead-refusals-col-state" })}</th>
            <th scope="col">{text({ id: "lead-refusals-col-recorded" })}</th>
            <th scope="col">{text({ id: "lead-refusals-col-reason" })}</th>
          </tr>
        </thead>
        <tbody>
          {props.refusals.refusals.map((refusal) => (
            <LeadRefusalRow
              key={refusal.ticket}
              refusal={refusal}
              nowMs={props.nowMs}
            />
          ))}
        </tbody>
      </Table>
    </>
  );
}

export function LeadRefusals(props: {
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const partition = props.partition;
  const state = usePanelState(agenticRefusalsQuery(partition));
  return (
    <DataPanel title={text({ id: "lead-refusals-title" })} state={state}>
      {(refusals) => (
        <LeadRefusalTable refusals={refusals} nowMs={props.nowMs} />
      )}
    </DataPanel>
  );
}
