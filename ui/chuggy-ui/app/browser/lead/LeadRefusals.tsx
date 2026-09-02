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
import { apiAgenticRefusals } from "../../core/apiRoutes.ts";
import { instantFigure } from "../../core/figures.ts";
import { agenticRefusalStanding } from "../../core/leadTranscript.ts";
import { projectListReread } from "../../core/projectQueryKeys.ts";
import { agenticRefusalStandingTone } from "../../core/tones.ts";
import { usePanelList } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";

export const leadRefusalsListName = "lead";

function LeadRefusalRow(props: {
  readonly refusal: AgenticRefusalResponse;
  readonly nowMs: number;
}): ReactNode {
  const refusal = props.refusal;
  const standing = agenticRefusalStanding(refusal);
  return (
    <tr>
      <td className="num">{refusal.ticket}</td>
      <td className="num">{refusal.ticketVersion}</td>
      <td>
        <Pill tone={agenticRefusalStandingTone(standing)}>{standing}</Pill>
      </td>
      <td>
        <Figure figure={instantFigure(refusal.recordedAt, props.nowMs)} />
      </td>
      <td className="lead-reason">{refusal.reason}</td>
    </tr>
  );
}

function LeadRefusalTable(props: {
  readonly refusals: AgenticRefusalsResponse;
  readonly nowMs: number;
}): ReactNode {
  if (props.refusals.refusals.length === 0)
    return <EmptyState label="No refusals" />;
  return (
    <>
      {props.refusals.more ? (
        <p className="lead-note">
          <span className="eyebrow">More</span>
        </p>
      ) : null}
      <Table caption="Standing refusals">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Version</th>
            <th scope="col">State</th>
            <th scope="col">Recorded</th>
            <th scope="col">Reason</th>
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
  const partition = props.partition;
  const state = usePanelList(
    projectListReread<AgenticRefusalsResponse>(
      partition,
      "AgenticRefusal",
      leadRefusalsListName,
    ),
    (ports) => apiAgenticRefusals(ports, partition),
  );
  return (
    <DataPanel title="Refusals" state={state}>
      {(refusals) => (
        <LeadRefusalTable refusals={refusals} nowMs={props.nowMs} />
      )}
    </DataPanel>
  );
}
