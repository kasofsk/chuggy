/**
 * The project's lead: where its session stands, what its mailbox has done, what
 * it currently holds, what it decided and what it is refusing to dispatch.
 *
 * The lead read is the `Session` change kind's own representation, so a turn
 * moving rewrites the head and raises the batch count the transcript walks to
 * and the page is live by construction. A project with no lead is a page
 * saying so rather than five empty panels. Where the lead runs on runners and
 * none of the project's can take its turn, the page says so beside either.
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
  LeadReadResponse,
  LeadResponse,
  LeadTurnResponse,
  SelectorProjectSettingsResponse,
} from "../../../../src/contract/responses.ts";
import { conversationExchanges } from "../core/conversation.ts";
import {
  costFigure,
  durationFigure,
  tokenCountFigure,
} from "../core/figures.ts";
import type { PanelState } from "../core/freshness.ts";
import { leadStreamBatches, leadStreamListed } from "../core/leadTranscript.ts";
import {
  projectLeadAbsenceLine,
  projectLeadAbsencePolledMs,
  projectLeadFound,
  projectLeadPanelState,
  projectLeadPresent,
} from "../core/projectLead.ts";
import { selectorSettingsQuery } from "../core/projectQueries.ts";
import { leadQuery } from "../core/sessionQueries.ts";
import { sessionRunnerShortWord } from "../core/sessionRunners.ts";
import type { SessionRunnerShort } from "../core/sessionRunners.ts";
import {
  sessionConversationItems,
  sessionConversationTurns,
} from "../core/sessionConversation.ts";
import {
  selectorAttentionTone,
  sessionStateTone,
  sessionTurnStateTone,
} from "../core/tones.ts";
import { usePanelState } from "./api.ts";
import { Conversation } from "./conversation/Conversation.tsx";
import { DataPanel, PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { LeadDecisions } from "./lead/LeadDecisions.tsx";
import { LeadInquiries, useInquiryBoxes } from "./lead/LeadInquiries.tsx";
import type { InquiryBoxesHeld } from "./lead/LeadInquiries.tsx";
import { LeadRefusals } from "./lead/LeadRefusals.tsx";
import { LeadNote, useLeadTranscript } from "./lead/LeadTranscript.tsx";
import { SelectorStrip } from "./lead/SelectorStrip.tsx";
import { useProjectAbilityRead } from "./projectAbilities.tsx";
import {
  selectorSettingsShown,
  useSelectorSettingsDraft,
  useSelectorSettingsWriting,
} from "./selectorSettingsWriting.ts";
import {
  SessionRunnerNotice,
  useSessionPlacement,
  useSessionRunnerShort,
} from "./sessionPlacement.tsx";
import { DetailsSlot, TopBarSlot } from "./shell/slots.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/**
 * The lead read, re-read on the `Session` frames that name its own session and
 * left alone by the rest, a project holding a session per thread beside its
 * lead, and polled while it last said there is none, since no frame moves why.
 * Which session that is, is learnt from the read and then KEPT, since a read
 * that has failed would otherwise leave the panel deaf to the very frame
 * telling it to try again, and until then any lead's frame re-reads it, which
 * is how a project with none hears that one has opened.
 */
export function useLead(
  partition: PartitionIdentity,
): PanelState<LeadReadResponse> {
  const [session, setSession] = useState<string | undefined>(undefined);
  const [absent, setAbsent] = useState(false);
  const state = usePanelState(
    leadQuery(
      partition,
      session,
      absent ? projectLeadAbsencePolledMs : undefined,
    ),
  );
  const named =
    state.state === "Ready"
      ? projectLeadFound(state.value)?.session
      : undefined;
  if (named !== undefined && named !== session) setSession(named);
  const present = projectLeadPresent(state);
  if (present !== undefined && present === absent) setAbsent(!present);
  return state;
}

/** The line beside a page's `No lead`, over the lead read the page holds and
 * the placement its runner notice is drawn from. */
export function useLeadAbsenceLine(
  partition: PartitionIdentity,
  read: PanelState<LeadReadResponse>,
  nowMs: number,
): string | undefined {
  const placement = useSessionPlacement(partition);
  return projectLeadAbsenceLine(
    read,
    nowMs,
    placement.state === "Ready" ? placement.value : undefined,
  );
}

/** The bar's own title, where the session stands, why no runner can take its
 * turn, how closely it needs watching, and the cursor its mailbox is at. */
function LeadTopBar(props: {
  readonly lead: LeadResponse;
  readonly runner: SessionRunnerShort | undefined;
}): ReactNode {
  const lead = props.lead;
  return (
    <TopBarSlot>
      <h1 className="visually-hidden">Lead</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Pill tone={sessionStateTone(lead.state)} emphasis>
          {lead.state}
        </Pill>
        {props.runner === undefined ? null : (
          <Pill tone="parked">{sessionRunnerShortWord(props.runner)}</Pill>
        )}
        <Pill tone={selectorAttentionTone(lead.attention)}>
          {lead.attention}
        </Pill>
        <span className="num text-ink-3 text-sm">
          {lead.notificationCursor}
        </span>
      </div>
    </TopBarSlot>
  );
}

/**
 * The strip once its own read is ready: a draft seeded from it and the one
 * door its press writes through, held here rather than above so a loading or
 * failed read says so in the strip's own place beside the standing.
 */
function LeadSelectorStripReady(props: {
  readonly partition: PartitionIdentity;
  readonly settings: SelectorProjectSettingsResponse;
}): ReactNode {
  const held = useSelectorSettingsDraft(props.settings);
  const writing = useSelectorSettingsWriting<"strip">(
    "Lead",
    props.partition,
    held,
  );
  return (
    <SelectorStrip
      draft={held.draft}
      settings={props.settings}
      editable
      busy={writing.saving.isPending}
      saved={selectorSettingsShown(writing, "strip")}
      onPress={(overrides) => {
        writing.write("strip", overrides, () => undefined);
      }}
    />
  );
}

/** The strip's own read, mounted for a reader that read would answer. */
function LeadSelectorStripRead(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelState(selectorSettingsQuery(partition));
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <LeadSelectorStripReady partition={partition} settings={state.value} />
  );
}

/** What the selector is doing for this project right now, which leads the page
 * because a paused selector is the first thing an operator needs to see. A
 * reader who may not manage the selector is refused its read and drawn none. */
function LeadSelectorStrip(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const read = useProjectAbilityRead(props.partition, "manageSelector");
  if (read === "Refused") return null;
  if (read === "Held") return <PanelUnready state={{ state: "Pending" }} />;
  return <LeadSelectorStripRead partition={props.partition} />;
}

function LeadTurnRow(props: { readonly turn: LeadTurnResponse }): ReactNode {
  const turn = props.turn;
  return (
    <tr>
      <td className="num">{turn.ordinal}</td>
      <td>{turn.inputKind}</td>
      <td>
        <Tooltip text={turn.failure}>
          <span>
            <Pill tone={sessionTurnStateTone(turn.state)}>{turn.state}</Pill>
          </span>
        </Tooltip>
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

/** What the lead is beside the conversation: its mailbox tail, what it
 * decided, what it refuses and the inquiries asked of it. Shown by default —
 * the lead's own state is what a reader came here to watch. */
function LeadDetails(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<LeadResponse>;
  readonly inquiries: InquiryBoxesHeld;
  readonly nowMs: number;
}): ReactNode {
  const lead = props.state.state === "Ready" ? props.state.value : undefined;
  return (
    <DetailsSlot openFirst>
      <DataPanel title="Turns" state={props.state}>
        {(value) => <LeadTurns lead={value} />}
      </DataPanel>
      <LeadDecisions partition={props.partition} nowMs={props.nowMs} />
      <LeadRefusals partition={props.partition} nowMs={props.nowMs} />
      <LeadInquiries
        partition={props.partition}
        head={lead?.agentReference}
        held={props.inquiries}
        nowMs={props.nowMs}
      />
    </DetailsSlot>
  );
}

/** The lead read is what the conversation waits on before there is a stream to
 * walk at all, so a lead still pending reads as a conversation still read. */
function LeadBody(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<LeadResponse>;
  readonly runner: SessionRunnerShort | undefined;
  readonly inquiries: InquiryBoxesHeld;
  readonly nowMs: number;
}): ReactNode {
  const lead = props.state.state === "Ready" ? props.state.value : undefined;
  const listed = lead !== undefined && leadStreamListed(lead);
  const walked = useLeadTranscript({
    of: { lead: props.partition },
    stream: lead?.agentReference,
    highWaterBatch: lead === undefined ? 0 : leadStreamBatches(lead),
  });
  const exchanges = conversationExchanges(
    sessionConversationItems({
      held: walked.held,
      stream: lead?.agentReference,
      listed,
      turned: (lead?.turns.length ?? 0) > 0,
    }),
    sessionConversationTurns(lead?.turns ?? []),
  );
  return (
    <>
      {lead === undefined ? null : (
        <LeadTopBar lead={lead} runner={props.runner} />
      )}
      <LeadSelectorStrip partition={props.partition} />
      <LeadDetails
        partition={props.partition}
        state={props.state}
        inquiries={props.inquiries}
        nowMs={props.nowMs}
      />
      <LeadNote note={lead?.handoffNote} />
      <div
        role="region"
        aria-label="Conversation"
        data-fills-page
        className="flex-1 min-h-0 min-w-0"
      >
        <Conversation
          exchanges={exchanges}
          reading={walked.reading || props.state.state === "Pending"}
          empty="No conversation"
          pane
        />
      </div>
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
  const read = useLead(partition);
  const state = projectLeadPanelState(read);
  const inquiries = useInquiryBoxes();
  const runner = useSessionRunnerShort(partition, "lead", "project");
  const absence = useLeadAbsenceLine(partition, read, nowMs);
  if (state.state === "Absent") {
    const action =
      runner === undefined ? undefined : (
        <SessionRunnerNotice
          partition={partition}
          session="Lead"
          short={runner}
        />
      );
    return (
      <>
        <LeadSelectorStrip partition={partition} />
        {absence === undefined ? (
          <EmptyState label="No lead" variant="page" action={action} />
        ) : (
          <EmptyState
            label="No lead"
            variant="page"
            detail={absence}
            action={action}
          />
        )}
      </>
    );
  }
  return (
    <LeadBody
      partition={partition}
      state={state}
      runner={runner}
      inquiries={inquiries}
      nowMs={nowMs}
    />
  );
}
