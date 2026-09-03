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
 * THERE IS A BOX PER PROJECT AND NONE OF THEM IS THIS PANEL'S. The question
 * typed at a box, the pair a send is outstanding under, whether a press is
 * outstanding at all and what the last press answered are all one project's, so
 * a project names which box is read, which box a press writes to, and which
 * project's listing an accepted press re-reads — and every one of them outlives
 * this panel, the page above it and the route, because `lead/inquiryBoxes.ts`
 * holds them for the tab. Nothing crosses between projects and nothing is lost
 * to a navigation: a reader who leaves and comes back finds what they left,
 * whichever way they left.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { inquiryQuestionCharsMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  LeadInquiriesResponse,
  LeadInquiryResponse,
} from "../../../../../src/contract/responses.ts";
import { apiAskLead, apiLeadInquiries } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import {
  costFigure,
  durationFigure,
  instantFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import {
  inquiryAskAnswered,
  inquiryAskerNamed,
  inquiryAsking,
  inquiryBoxAnswered,
  inquiryBoxName,
  inquiryBoxOf,
  inquiryBoxSent,
  inquiryBoxTyped,
  inquiryDraw,
  inquiryIdentityBytesCount,
  inquiryQuestion,
  inquiryQuestionFault,
  inquirySessionKind,
} from "../../core/leadInquiries.ts";
import type { InquiryAsk } from "../../core/leadInquiries.ts";
import { sessionChangeKindNamed } from "../../core/leadTranscript.ts";
import { inquiryBoxesHeld } from "./inquiryBoxes.ts";
import type { InquiryBoxStore } from "./inquiryBoxes.ts";
import { projectListRereadNamed } from "../../core/projectQueryKeys.ts";
import type { ProjectList } from "../../core/projectQueryKeys.ts";
import { sessionTurnStateTone } from "../../core/tones.ts";
import { useApiPorts, usePanelList } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";

export const leadInquiriesListName = "inquiries";

/**
 * The boxes as a screen reads them: the store's own, and a render whenever it
 * moves.
 *
 * WHAT IS HELD IS THE MODULE'S AND NOT THIS TREE'S, because the pair is a
 * de-duplication token and every component boundary is another way to lose one —
 * the head that gates the control is absent on the render after a project
 * switch, on a lead that has never settled a turn and on one whose read failed,
 * and the page itself is replaced by a click on any sibling screen, all of which
 * `inquiryBoxes.ts` argues at length while this is only how a screen reads it.
 */
export type InquiryBoxesHeld = InquiryBoxStore;

export function useInquiryBoxes(): InquiryBoxesHeld {
  useSyncExternalStore(inquiryBoxesHeld.subscribe, inquiryBoxesHeld.boxes);
  return inquiryBoxesHeld;
}

/**
 * One project's inquiries, re-read on the `Session` frames naming an inquiry
 * and left alone by every other kind. Built from a project rather than closed
 * over the one on screen, because an accepted press re-reads the project it was
 * asked in and that is not always the project being drawn when it answers.
 */
function leadInquiriesList(
  partition: PartitionIdentity,
): ProjectList<LeadInquiriesResponse> {
  return projectListRereadNamed<LeadInquiriesResponse>(
    partition,
    "Session",
    leadInquiriesListName,
    (change) => sessionChangeKindNamed(change.resource) === inquirySessionKind,
  );
}

/** What the last ask did, in the one line the box says it in. */
function LeadAskNotice(props: { readonly ask: InquiryAsk }): ReactNode {
  const ask = props.ask;
  switch (ask.ask) {
    case "Idle":
      return null;
    case "Asking":
      return <Notice tone="info" inline detail="Asking" />;
    case "Asked":
      return <Notice tone="live" inline detail="Asked" />;
    case "Refused":
      return <Notice tone="parked" inline detail={ask.word} />;
    case "Failed":
      return <Notice tone="danger" inline detail={`Failed · ${ask.reason}`} />;
  }
}

/**
 * The box, whose control is the whole of what refuses a question past the bound
 * — a press a disabled control never dispatches is a branch nothing can reach,
 * so a second check inside the press would be a control nothing can prove.
 *
 * ONE PRESS IS ONE QUESTION, AND THE FLAG THAT SAYS SO IS A REF RATHER THAN THE
 * DRAWN STATE — two presses inside one render both read the render they were
 * drawn from, so the control being disabled by the next one stops neither; it is
 * released on every answer, a refusal that latched the box shut leaving a reader
 * nothing to try again with, and the pair is held until one is accepted, so a
 * re-send is the retry the door is idempotent on rather than a second question
 * spending the second of the asker's two.
 */
function LeadAsk(props: {
  readonly partition: PartitionIdentity;
  readonly held: InquiryBoxesHeld;
  readonly onAsked: (partition: PartitionIdentity) => void;
}): ReactNode {
  const ports = useApiPorts();
  const partition = props.partition;
  const { write, outstanding } = props.held;
  const boxes = props.held.boxes();
  const box = inquiryBoxOf(boxes, partition);
  const question = inquiryQuestion(box.typed);
  const fault = inquiryQuestionFault(question);
  const shown = box.typed === "" ? undefined : fault;
  const submit = () => {
    const name = inquiryBoxName(partition);
    if (outstanding.taken(name)) return;
    outstanding.take(name);
    const draw = inquiryDraw(box.held, question, partition, () =>
      base64urlFromBytes(drawBytes(inquiryIdentityBytesCount)),
    );
    write(partition, (held) => inquiryBoxSent(held, draw));
    void (async () => {
      const answered = inquiryAskAnswered(
        await apiAskLead(ports, draw.partition, inquiryAsking(draw)),
      );
      outstanding.release(name);
      write(draw.partition, (held) => inquiryBoxAnswered(held, draw, answered));
      if (answered.ask !== "Asked") return;
      props.onAsked(draw.partition);
    })();
  };
  return (
    <div className="lead-ask">
      <LeadAskNotice ask={box.ask} />
      <Fields>
        <Field name="Question">
          <textarea
            className="lead-ask-text"
            aria-label="Question"
            aria-invalid={shown !== undefined}
            value={box.typed}
            onChange={(event) => {
              const typed = event.target.value;
              write(partition, (held) => inquiryBoxTyped(held, typed));
            }}
          />
          <span className="num">{`${String(question.length)} / ${String(inquiryQuestionCharsMax)}`}</span>
          {shown === undefined ? null : <Pill tone="fail">{shown}</Pill>}
        </Field>
      </Fields>
      <Button
        variant="primary"
        busy={box.ask.ask === "Asking"}
        disabled={fault !== undefined || box.ask.ask === "Asking"}
        onClick={submit}
      >
        Ask
      </Button>
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
    <li className="lead-inquiry">
      <div className="lead-inquiry-head">
        <span className="lead-inquiry-asker">
          {inquiryAskerNamed(inquiry.asker)}
        </span>
        {inquiry.mine ? <Pill tone="neutral">Mine</Pill> : null}
        <span title={inquiry.failure}>
          <Pill tone={sessionTurnStateTone(inquiry.turnState)}>
            {inquiry.turnState}
          </Pill>
        </span>
        <Figure figure={instantFigure(inquiry.askedAt, props.nowMs)} />
        <LeadInquiryRollup inquiry={inquiry} />
      </div>
      <p className="lead-inquiry-question">{inquiry.question}</p>
      {inquiry.answer === undefined ? null : (
        <pre className="lead-entry-text">{inquiry.answer}</pre>
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
    <ol className="lead-inquiries">
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

export function LeadInquiries(props: {
  readonly partition: PartitionIdentity;
  /** The lead's runtime reference, which is the head a fork is taken from. */
  readonly head: string | undefined;
  /** The boxes, which are the module's and outlive this panel and its page. */
  readonly held: InquiryBoxesHeld;
  readonly nowMs: number;
}): ReactNode {
  const partition = props.partition;
  const client = useQueryClient();
  const state = usePanelList(leadInquiriesList(partition), (ports) =>
    apiLeadInquiries(ports, partition),
  );
  return (
    <Panel title="Inquiries">
      {props.head === undefined ? null : (
        <LeadAsk
          partition={partition}
          held={props.held}
          onAsked={(at) => {
            void client.invalidateQueries({
              queryKey: leadInquiriesList(at).key,
              exact: true,
            });
          }}
        />
      )}
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <LeadInquiryList inquiries={state.value} nowMs={props.nowMs} />
      ) : null}
    </Panel>
  );
}
