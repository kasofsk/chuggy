/**
 * The questions members have asked this lead aside, and the box for asking one.
 *
 * THE PANEL WATCHES A KIND AND THE LEAD PANEL WATCHES A SESSION. An inquiry is
 * a fork with a session of its own, so its turn moving is a `Session` frame
 * naming that fork and never the lead — and the lead's own predicate, which
 * names one session, is right to ignore it. Widening that predicate instead
 * would make every question re-read the head, the mailbox tail and the
 * transcript walk of a lead that had not moved.
 *
 * THE FRAME IS A POINTER AND THE LISTING IS RE-READ. What a frame carries about
 * an inquiry is that one moved; what a row draws is the asker the membership
 * audits, whether it is the caller's own, and the answer — all of which the
 * route derives and the frame does not carry.
 *
 * THE ANSWER IS TEXT. It is model prose from a fork of the lead, and this
 * console does not interpret it: it is drawn as characters, never as markup,
 * whatever it happens to contain.
 *
 * A LEAD WITH NO HEAD DRAWS NO BOX. An inquiry is a fork, so a lead that has
 * never settled a turn has nothing to fork from and the door would refuse; a
 * box that posted anyway would spend a reader's attention on a refusal this
 * page already knows about.
 *
 * AN INQUIRY RUNS ON THE ASKER'S OWN RUNNER where the lead runs on runners, so
 * the box says when theirs cannot take it, whatever the project's others do.
 *
 * THERE IS A BOX PER PROJECT AND NONE OF THEM IS THIS PANEL'S. The question
 * once it leaves the box, the pair a send is outstanding under, whether a press
 * is outstanding at all and what the last press answered are all one project's,
 * so a project names which box is read, which write a press is, and which
 * project's listing an accepted press re-reads — and every one of them outlives
 * this panel, the page above it and the route: `lead/inquiryBoxes.ts` holds the
 * box in the console's store, and the press is a write under a key naming the
 * project.
 * A question leaves the box on a blur or a press. Until then a keystroke is the
 * box's own, and text typed and never left goes with the box. Nothing crosses
 * between projects, and the pair, the pending press and the last answer are
 * not lost to a navigation: a reader who leaves and comes back finds them,
 * whichever way they left.
 */

import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  inquiryQuestionCharsMax,
  partitionPath,
} from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  LeadInquiriesResponse,
  LeadInquiryAccepted,
  LeadInquiryResponse,
} from "../../../../../src/contract/responses.ts";
import { apiAskLead } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  costFigure,
  durationFigure,
  instantFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import {
  inquiryAskRefusalSentence,
  inquiryAskRefused,
  inquiryAskerNamed,
  inquiryAsking,
  inquiryDraw,
  inquiryIdentityBytesCount,
  inquiryQuestion,
  inquiryQuestionFault,
} from "../../core/leadInquiries.ts";
import type {
  InquiryAsk,
  InquiryBox,
  InquiryDraw,
} from "../../core/leadInquiries.ts";
import {
  inquiryBoxAnsweredAt,
  inquiryBoxAt,
  inquiryBoxSentAt,
  inquiryBoxTypedAt,
} from "./inquiryBoxes.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { leadInquiriesQuery } from "../../core/sessionQueries.ts";
import { sessionTurnStateTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { useProjectAbilities, ViewOnlyNotice } from "../projectAbilities.tsx";
import { useConsoleDispatch, useConsoleSelector } from "../store.ts";
import type { ConsoleDispatch } from "../store.ts";
import {
  SessionRunnerNotice,
  useSessionRunnerShort,
} from "../sessionPlacement.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

import "./LeadInquiries.css";

/** One project's box as a screen reads it, and a render whenever it moves. */
function useInquiryBox(partition: PartitionIdentity): InquiryBox {
  return useConsoleSelector((state) => inquiryBoxAt(state, partition));
}

/**
 * One project's asks, keyed by the project the box is. What a press was
 * answered is written into the box, which outlives the write: a settled write is
 * collected once nothing observes it, and a reader who comes back to a project
 * finds what its last press said for as long as the box is kept.
 */
function leadAskWrite(
  partition: PartitionIdentity,
  dispatch: ConsoleDispatch,
): ConsoleWrite<InquiryDraw, LeadInquiryAccepted> {
  return {
    mutationKey: consoleWriteKey(
      "lead-inquiry",
      partition.tenant,
      partition.project,
    ),
    write: (ports, draw) =>
      apiAskLead(ports, draw.partition, inquiryAsking(draw)),
    refusal: (failure) => inquiryAskRefusalSentence(inquiryAskRefused(failure)),
    landed: (client, accepted, draw) => {
      dispatch(
        inquiryBoxAnsweredAt({
          draw,
          answer: { ask: "Asked", session: accepted.session },
        }),
      );
      return client.invalidateQueries({
        queryKey: leadInquiriesQuery(draw.partition).queryKey,
        exact: true,
      });
    },
    refused: (error, draw) => {
      dispatch(
        inquiryBoxAnsweredAt({
          draw,
          answer:
            error.failure === undefined
              ? {
                  ask: "Failed",
                  words: { word: "Failed", detail: error.message },
                }
              : inquiryAskRefused(error.failure),
        }),
      );
    },
  };
}

/** What the last ask did, in the one line the box says it in. */
function LeadAskNotice(props: {
  readonly partition: PartitionIdentity;
  readonly ask: InquiryAsk;
  readonly pending: boolean;
}): ReactNode {
  if (props.pending) return <Notice tone="info" inline detail="Asking" />;
  const ask = props.ask;
  switch (ask.ask) {
    case "Idle":
      return null;
    case "Asked":
      return <Notice tone="live" inline detail="Asked" />;
    case "Refused":
      return <Notice tone="parked" inline detail={ask.word} />;
    case "NoRunner":
      return (
        <SessionRunnerNotice
          partition={props.partition}
          session="Inquiry"
          short="NoRunner"
        />
      );
    case "Failed":
      return (
        <Notice tone="danger" inline>
          <Tooltip text={ask.words.detail}>
            <span>{inquiryAskRefusalSentence(ask)}</span>
          </Tooltip>
        </Notice>
      );
  }
}

/** Why the asker's chat host cannot take a question now, unless the last
 * press was refused, which says why in its own word. */
function LeadAskRunner(props: {
  readonly partition: PartitionIdentity;
  readonly ask: InquiryAsk;
  readonly pending: boolean;
}): ReactNode {
  const runner = useSessionRunnerShort(props.partition, "lead", "inquiry");
  const refused = props.pending ? undefined : props.ask.ask;
  return runner === undefined ||
    refused === "Refused" ||
    refused === "NoRunner" ? null : (
    <SessionRunnerNotice
      partition={props.partition}
      session="Inquiry"
      short={runner}
    />
  );
}

/**
 * The box, whose control is the whole of what refuses a question past the bound
 * — a press a disabled control never dispatches is a branch nothing can reach,
 * so a second check inside the press would be a control nothing can prove.
 *
 * ONE PRESS IS ONE QUESTION, AND WHAT SAYS SO IS THE CACHE RATHER THAN THE
 * DRAWN STATE — two presses inside one render both read the render they were
 * drawn from, so the control being disabled by the next one stops neither,
 * while a write is pending in the cache from the moment it is sent; it is over
 * on every answer, a refusal that latched the box shut leaving a reader nothing
 * to try again with, and the pair is held until one is accepted, so a re-send
 * is the retry the door is idempotent on rather than a second question
 * spending the second of the asker's two.
 */
function LeadAsk(props: { readonly partition: PartitionIdentity }): ReactNode {
  const client = useQueryClient();
  const dispatch = useConsoleDispatch();
  const partition = props.partition;
  const write = leadAskWrite(partition, dispatch);
  const asking = useConsoleWrite(write, { drawn: true });
  const pending =
    useIsMutating({ mutationKey: write.mutationKey, exact: true }) > 0;
  const box = useInquiryBox(partition);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const typed = draft ?? box.typed;
  const question = inquiryQuestion(typed);
  const fault = inquiryQuestionFault(question);
  const shown = typed === "" ? undefined : fault;
  const left = () => {
    if (draft === undefined) return;
    dispatch(inquiryBoxTypedAt({ partition, typed: draft }));
    setDraft(undefined);
  };
  const submit = () => {
    if (client.isMutating({ mutationKey: write.mutationKey, exact: true }) > 0)
      return;
    left();
    const draw = inquiryDraw(box.held, question, partition, () =>
      base64urlFromBytes(drawBytes(inquiryIdentityBytesCount)),
    );
    dispatch(inquiryBoxSentAt(draw));
    asking.mutate(draw);
  };
  return (
    <div className="grid min-w-0 gap-2 pb-3">
      <LeadAskNotice partition={partition} ask={box.ask} pending={pending} />
      <LeadAskRunner partition={partition} ask={box.ask} pending={pending} />
      <Fields>
        <Field name="Question">
          <textarea
            className="inquiry-ask-text w-full resize-y"
            aria-label="Question"
            aria-invalid={shown !== undefined}
            value={typed}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onBlur={left}
          />
          <span className="num">{`${String(question.length)} / ${String(inquiryQuestionCharsMax)}`}</span>
          {shown === undefined ? null : <Pill tone="fail">{shown}</Pill>}
        </Field>
      </Fields>
      <div className="justify-self-start">
        <Button
          variant="primary"
          busy={pending}
          disabled={fault !== undefined || pending}
          onClick={submit}
        >
          Ask
        </Button>
      </div>
    </div>
  );
}

/**
 * What one question cost the account the whole project shares, which is the
 * lead's own, so a reader can see what asking spends.
 */
function LeadInquiryRollup(props: {
  readonly inquiry: LeadInquiryResponse;
}): ReactNode {
  const inquiry = props.inquiry;
  if (
    inquiry.costMicros === undefined &&
    inquiry.tokens === undefined &&
    inquiry.durationMs === undefined
  )
    return null;
  return (
    <>
      {inquiry.costMicros === undefined ? null : (
        <Figure figure={costFigure(inquiry.costMicros, "List")} />
      )}
      {inquiry.tokens === undefined ? null : (
        <Figure figure={tokenCountFigure(inquiry.tokens)} />
      )}
      {inquiry.durationMs === undefined ? null : (
        <Figure figure={durationFigure(inquiry.durationMs)} />
      )}
    </>
  );
}

function LeadInquiryRow(props: {
  readonly inquiry: LeadInquiryResponse;
  readonly nowMs: number;
}): ReactNode {
  const inquiry = props.inquiry;
  return (
    <li className="grid min-w-0 gap-1 border-t border-edge pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-3 max-w-measure truncate font-mono text-xs">
          {inquiryAskerNamed(inquiry.asker)}
        </span>
        {inquiry.mine ? <Pill tone="neutral">Mine</Pill> : null}
        <Tooltip text={inquiry.failure}>
          <span>
            <Pill tone={sessionTurnStateTone(inquiry.turnState)}>
              {inquiry.turnState}
            </Pill>
          </span>
        </Tooltip>
        <Figure figure={instantFigure(inquiry.askedAt, props.nowMs)} />
        <LeadInquiryRollup inquiry={inquiry} />
      </div>
      <p className="max-w-measure">{inquiry.question}</p>
      {inquiry.answer === undefined ? null : (
        <pre className="bg-surface-2 text-ink-1 rounded-2 max-h-(--height-clip) overflow-auto p-2 font-mono text-xs whitespace-pre-wrap">
          {inquiry.answer}
        </pre>
      )}
    </li>
  );
}

/** The listing as the route arranged it, which is newest first and bounded. */
function LeadInquiryList(props: {
  readonly inquiries: LeadInquiriesResponse;
  readonly nowMs: number;
}): ReactNode {
  if (props.inquiries.inquiries.length === 0)
    return <EmptyState label="No inquiries" />;
  return (
    <ol className="grid min-w-0 list-none gap-3 p-0">
      {props.inquiries.inquiries.map((inquiry) => (
        <LeadInquiryRow
          key={inquiry.session}
          inquiry={inquiry}
          nowMs={props.nowMs}
        />
      ))}
    </ol>
  );
}

/** The box, or the one line where the reader may ask nothing. */
function LeadAskOffered(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  if (projectAbilityRefused(abilities, "mutate")) return <ViewOnlyNotice />;
  return (
    <LeadAsk key={partitionPath(props.partition)} partition={props.partition} />
  );
}

export function LeadInquiries(props: {
  readonly partition: PartitionIdentity;
  /** The lead's runtime reference, which is the head a fork is taken from. */
  readonly head: string | undefined;
  readonly nowMs: number;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelState(leadInquiriesQuery(partition));
  return (
    <Panel title="Inquiries">
      {props.head === undefined ? null : (
        <LeadAskOffered partition={partition} />
      )}
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <LeadInquiryList inquiries={state.value} nowMs={props.nowMs} />
      ) : null}
    </Panel>
  );
}
