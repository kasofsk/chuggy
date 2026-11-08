/**
 * The decision log: what the lead decided, newest first, each group holding one
 * row per dispatch with the landing that dispatch reached, beside the tickets
 * it refused and the refusals it lifted.
 *
 * WHAT WAS CHOSEN IS NOT WHAT LANDED. One decision's dispatches are delivered
 * and settled one at a time, so a decision that named three can have landed
 * one; a single dispatch arm over a list of ticket numbers would say all three
 * went, which is the reading this panel had before the record could tell.
 *
 * THE READ IS THE LOG'S NEWEST END AND NOT ITS FIRST PAGE. `order=newest`
 * answers the last `limit` decisions as one bounded page with no cursor, so the
 * panel is one read; asking for the default ascending arm and dropping its
 * cursor would show a project's first decisions forever. Which row is current
 * is decided from the ordinals rather than from the page's arrangement, so a
 * page arriving the other way up is drawn right way up rather than mislabelled.
 *
 * The log has no change kind of its own, so it is re-read on the partition
 * invalidation the stream's fallback already performs; what a decision saw is
 * not drawn here, because the observation is a page of candidates and this is
 * the record of what was done with it. A dispatch held for approval points to
 * the inbox, which is the one place it is answered.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  SelectorDecisionResponse,
  SelectorHistoryResponse,
} from "../../../../../src/contract/responses.ts";
import {
  costFigure,
  durationFigure,
  instantFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import {
  leadDecisionsNewestFirst,
  leadDecisionSummary,
} from "../../core/leadTranscript.ts";
import { leadDecisionsQuery } from "../../core/sessionQueries.ts";
import { navRoutes } from "../../core/shellNav.ts";
import { leadDispatchArm } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import type { Copy } from "../../core/copy.ts";
import { usePanelState } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Ledger, LedgerBlock, LedgerGroup, LedgerRow } from "../ui/Ledger.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

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
            ? { kind: "Absent", why: { id: "figures-absent-cost" } }
            : costFigure(decision.costMicros, "List")
        }
      />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure
        figure={
          decision.tokens === undefined
            ? { kind: "Absent", why: { id: "figures-absent-tokens" } }
            : tokenCountFigure(decision.tokens)
        }
      />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure
        figure={
          decision.durationMs === undefined
            ? { kind: "Absent", why: { id: "figures-absent-duration" } }
            : durationFigure(decision.durationMs)
        }
      />
    </>
  );
}

interface LeadDecisionArm {
  readonly id: "refused" | "lifted";
  readonly label: Copy;
  readonly tickets: readonly number[];
  readonly tone: Tone;
}

/**
 * The two arms that are still one row over a list of ticket numbers: every
 * ticket in either was decided the same way at the same moment, and there is
 * nothing further to say about any one of them. What was dispatched is not one
 * of these, because each dispatch has a delivery of its own that lands or does
 * not.
 */
function leadDecisionArms(
  decision: SelectorDecisionResponse,
): readonly LeadDecisionArm[] {
  return [
    {
      id: "refused",
      label: { id: "lead-decision-refused" },
      tickets: decision.refused,
      tone: "fail",
    },
    {
      id: "lifted",
      label: { id: "lead-decision-lifted" },
      tickets: decision.lifted,
      tone: "retired",
    },
  ];
}

/** What one decision did, a row at a time: its dispatches with their landings,
 * then the tickets it refused and lifted, and the ghost where it did none. */
function LeadDecisionRows(props: {
  readonly partition: PartitionIdentity;
  readonly decision: SelectorDecisionResponse;
  readonly when: FigureValue;
}): ReactNode {
  const decision = props.decision;
  const text = useCopyText();
  const arms = leadDecisionArms(decision).filter(
    (arm) => arm.tickets.length > 0,
  );
  if (decision.dispatches.length === 0 && arms.length === 0)
    return (
      <LedgerRow
        label={text({ id: "lead-decision-tickets-label" })}
        pill={{ tone: "retired", text: text({ id: "lead-decision-none" }) }}
        ghost
        when={props.when}
      />
    );
  return (
    <>
      {decision.dispatches.map((dispatch) => {
        const arm = leadDispatchArm(dispatch);
        return (
          <LedgerRow
            key={dispatch.ticket}
            label={text({ id: "lead-decision-dispatch-label" })}
            pill={{ tone: arm.tone, text: text(arm.word) }}
            when={props.when}
            note={
              dispatch.state === "AwaitingApproval" ? (
                <>
                  {String(dispatch.ticket)}
                  <span className="text-ink-3">
                    {" · "}
                    <Link to={navRoutes.inbox} params={props.partition}>
                      {text({ id: "lead-decision-inbox-link" })}
                    </Link>
                  </span>
                </>
              ) : (
                String(dispatch.ticket)
              )
            }
          />
        );
      })}
      {arms.map((arm) => (
        <LedgerRow
          key={arm.id}
          label={text(arm.label)}
          pill={{ tone: arm.tone, text: text(arm.label) }}
          when={props.when}
          note={arm.tickets.map((ticket) => String(ticket)).join(", ")}
        />
      ))}
    </>
  );
}

function LeadDecisionGroup(props: {
  readonly partition: PartitionIdentity;
  readonly decision: SelectorDecisionResponse;
  readonly current: boolean;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const decision = props.decision;
  return (
    <LedgerGroup
      title={text({
        id: "lead-decision-title",
        args: { ordinal: String(decision.ordinal) },
      })}
      standing={props.current ? "Current" : "Superseded"}
      summary={leadDecisionSummary(decision, text)}
      rollup={<LeadDecisionRollup decision={decision} />}
      open={props.current}
    >
      <LedgerBlock eyebrow={decision.decision}>
        <LeadDecisionRows
          partition={props.partition}
          decision={decision}
          when={instantFigure(decision.completedAt, props.nowMs)}
        />
      </LedgerBlock>
    </LedgerGroup>
  );
}

function LeadDecisionList(props: {
  readonly partition: PartitionIdentity;
  readonly history: SelectorHistoryResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const decisions = leadDecisionsNewestFirst(props.history.decisions);
  const newest = decisions[0]?.ordinal;
  if (decisions.length === 0)
    return <EmptyState label={text({ id: "lead-decisions-none" })} />;
  return (
    <Ledger>
      {decisions.map((decision) => (
        <LeadDecisionGroup
          key={decision.decision}
          partition={props.partition}
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
  const text = useCopyText();
  const partition = props.partition;
  const state = usePanelState(leadDecisionsQuery(partition));
  return (
    <DataPanel title={text({ id: "lead-decisions-title" })} state={state}>
      {(history) => (
        <LeadDecisionList
          partition={partition}
          history={history}
          nowMs={props.nowMs}
        />
      )}
    </DataPanel>
  );
}
