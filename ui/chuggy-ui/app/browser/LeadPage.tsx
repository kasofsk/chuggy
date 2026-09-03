/**
 * The project's lead: where its session stands, what its mailbox has done, what
 * it currently holds, what it decided and what it is refusing to dispatch.
 *
 * The lead read is the `Session` change kind's own representation, so a turn
 * moving rewrites the head and raises the batch count the transcript walks to
 * and the page is live by construction. A project with no lead answers `404`,
 * which is a page saying so rather than five empty panels.
 *
 * WHAT A READER HAS TYPED AT THE INQUIRY BOX IS NOT HELD HERE. This page is
 * replaced outright by a click on any sibling screen, and the pair a box holds
 * is the token that makes a re-send a retry rather than a second question — so
 * it lives in `lead/inquiryBoxes.ts`, which no navigation reaches, and this
 * page only reads it.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  LeadResponse,
  LeadTurnResponse,
} from "../../../../src/contract/responses.ts";
import { apiLead } from "../core/apiRoutes.ts";
import {
  costFigure,
  durationFigure,
  tokenCountFigure,
} from "../core/figures.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  leadSessionNamed,
  leadStreamBatches,
  leadStreamListed,
} from "../core/leadTranscript.ts";
import { projectListRereadNamed } from "../core/projectQueryKeys.ts";
import {
  selectorAttentionTone,
  sessionStateTone,
  sessionTurnStateTone,
} from "../core/tones.ts";
import { usePanelList } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { LeadDecisions } from "./lead/LeadDecisions.tsx";
import { LeadInquiries, useInquiryBoxes } from "./lead/LeadInquiries.tsx";
import type { InquiryBoxesHeld } from "./lead/LeadInquiries.tsx";
import { LeadRefusals } from "./lead/LeadRefusals.tsx";
import {
  LeadHolding,
  LeadLog,
  useLeadTranscript,
} from "./lead/LeadTranscript.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, Fields } from "./ui/Fields.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";

import "./lead/lead.css";

export const leadListName = "lead";

/**
 * The lead read, re-read on the `Session` frames that name its own session and
 * left alone by the rest, a project holding a session per thread beside its
 * lead. Which session that is, is learnt from the read and then KEPT, since a
 * read that has failed would otherwise leave the panel deaf to the very frame
 * telling it to try again.
 */
export function useLead(
  partition: PartitionIdentity,
): PanelState<LeadResponse> {
  const [session, setSession] = useState<string | undefined>(undefined);
  const state = usePanelList(
    projectListRereadNamed<LeadResponse>(
      partition,
      "Session",
      leadListName,
      (change) =>
        session !== undefined && leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiLead(ports, partition),
  );
  const named = state.state === "Ready" ? state.value.session : undefined;
  if (named !== undefined && named !== session) setSession(named);
  return state;
}

function LeadHead(props: { readonly lead: LeadResponse }): ReactNode {
  const lead = props.lead;
  return (
    <div className="lead-head">
      <div className="lead-title">
        <h1>Lead</h1>
        <p className="lead-session">{lead.session}</p>
      </div>
      <div className="lead-state">
        <Pill tone={sessionStateTone(lead.state)} emphasis>
          {lead.state}
        </Pill>
        <Pill tone={selectorAttentionTone(lead.attention)}>
          {lead.attention}
        </Pill>
      </div>
      <Fields variant="inline">
        <Field name="Reference" absent={lead.agentReference === undefined}>
          {lead.agentReference ?? "None"}
        </Field>
        <Field name="Cursor">
          <span className="num">{lead.notificationCursor}</span>
        </Field>
      </Fields>
    </div>
  );
}

function LeadTurnRow(props: { readonly turn: LeadTurnResponse }): ReactNode {
  const turn = props.turn;
  return (
    <tr>
      <td className="num">{turn.ordinal}</td>
      <td>{turn.inputKind}</td>
      <td>
        <span title={turn.failure}>
          <Pill tone={sessionTurnStateTone(turn.state)}>{turn.state}</Pill>
        </span>
      </td>
      <td>{turn.model ?? "—"}</td>
      <td className="num">
        <Figure
          figure={
            turn.tokens === undefined
              ? { kind: "Absent", why: "No tokens measured" }
              : tokenCountFigure(turn.tokens)
          }
        />
      </td>
      <td className="num">
        <Figure
          figure={
            turn.costMicros === undefined
              ? { kind: "Absent", why: "No cost measured" }
              : costFigure(turn.costMicros, "List")
          }
        />
      </td>
      <td className="num">
        <Figure
          figure={
            turn.durationMs === undefined
              ? { kind: "Absent", why: "No duration measured" }
              : durationFigure(turn.durationMs)
          }
        />
      </td>
    </tr>
  );
}

/** The mailbox tail, newest last, with what the pod measured of each turn. */
function LeadTurns(props: { readonly lead: LeadResponse }): ReactNode {
  if (props.lead.turns.length === 0) return <EmptyState label="No turns" />;
  return (
    <Table caption="Turns">
      <thead>
        <tr>
          <th scope="col">Turn</th>
          <th scope="col">Input</th>
          <th scope="col">State</th>
          <th scope="col">Model</th>
          <th scope="col">Tokens</th>
          <th scope="col">Cost</th>
          <th scope="col">Duration</th>
        </tr>
      </thead>
      <tbody>
        {props.lead.turns.map((turn) => (
          <LeadTurnRow key={turn.turn} turn={turn} />
        ))}
      </tbody>
    </Table>
  );
}

function LeadBody(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<LeadResponse>;
  readonly inquiries: InquiryBoxesHeld;
  readonly nowMs: number;
}): ReactNode {
  const lead = props.state.state === "Ready" ? props.state.value : undefined;
  const listed = lead !== undefined && leadStreamListed(lead);
  const held = useLeadTranscript({
    partition: props.partition,
    stream: lead?.agentReference,
    highWaterBatch: lead === undefined ? 0 : leadStreamBatches(lead),
  });
  return (
    <>
      {lead === undefined ? null : <LeadHead lead={lead} />}
      <DataPanel title="Turns" state={props.state}>
        {(value) => <LeadTurns lead={value} />}
      </DataPanel>
      <LeadHolding
        held={held}
        note={lead?.handoffNote}
        stream={lead?.agentReference}
        listed={listed}
        nowMs={props.nowMs}
      />
      <LeadLog held={held} stream={lead?.agentReference} listed={listed} />
      <LeadDecisions partition={props.partition} nowMs={props.nowMs} />
      <LeadRefusals partition={props.partition} nowMs={props.nowMs} />
      <LeadInquiries
        partition={props.partition}
        head={lead?.agentReference}
        held={props.inquiries}
        nowMs={props.nowMs}
      />
    </>
  );
}

export function LeadPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/lead" });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const nowMs = useNowMs();
  const state = useLead(partition);
  const inquiries = useInquiryBoxes();
  if (state.state === "Absent")
    return <EmptyState label="No lead" variant="page" />;
  return (
    <div className="lead">
      <LeadBody
        partition={partition}
        state={state}
        inquiries={inquiries}
        nowMs={nowMs}
      />
    </div>
  );
}
