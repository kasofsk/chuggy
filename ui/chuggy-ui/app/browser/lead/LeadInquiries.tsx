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
 * A PROJECT SWITCH IS NOT A REMOUNT, so everything this page holds outlives the
 * project it was held for: the lead route declares no `remountDeps` and the
 * router sets no default, so a params-only navigation reconciles these
 * components rather than replacing them. What the box holds is therefore scoped
 * to a project by the box itself — the pair carries the project it was drawn
 * for, a session name being unique across the whole installation while the door
 * that takes it is one project's, and the box's last word is dropped when the
 * project moves under it rather than read as the new project's.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
  inquiryAsking,
  inquiryDraw,
  inquiryIdentityBytesCount,
  inquiryQuestion,
  inquiryQuestionFault,
  inquirySessionKind,
} from "../../core/leadInquiries.ts";
import type { InquiryAsk, InquiryDraw } from "../../core/leadInquiries.ts";
import { sessionChangeKindNamed } from "../../core/leadTranscript.ts";
import { projectListRereadNamed } from "../../core/projectQueryKeys.ts";
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
  readonly onAsked: () => void;
}): ReactNode {
  const ports = useApiPorts();
  const partition = props.partition;
  const [typed, setTyped] = useState("");
  const [ask, setAsk] = useState<InquiryAsk>({ ask: "Idle" });
  const [seen, setSeen] = useState<PartitionIdentity>(partition);
  const inFlight = useRef(false);
  const held = useRef<InquiryDraw | undefined>(undefined);
  const question = inquiryQuestion(typed);
  const fault = inquiryQuestionFault(question);
  const shown = typed === "" ? undefined : fault;
  if (seen.tenant !== partition.tenant || seen.project !== partition.project) {
    setSeen(partition);
    setAsk({ ask: "Idle" });
  }
  const submit = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAsk({ ask: "Asking" });
    void (async () => {
      const draw = inquiryDraw(held.current, question, partition, () =>
        base64urlFromBytes(drawBytes(inquiryIdentityBytesCount)),
      );
      held.current = draw;
      const answered = inquiryAskAnswered(
        await apiAskLead(ports, partition, inquiryAsking(draw)),
      );
      inFlight.current = false;
      setAsk(answered);
      if (answered.ask !== "Asked") return;
      held.current = undefined;
      setTyped("");
      props.onAsked();
    })();
  };
  return (
    <div className="lead-ask">
      <LeadAskNotice ask={ask} />
      <Fields>
        <Field name="Question">
          <textarea
            className="lead-ask-text"
            aria-label="Question"
            aria-invalid={shown !== undefined}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
          <span className="num">{`${String(question.length)} / ${String(inquiryQuestionCharsMax)}`}</span>
          {shown === undefined ? null : <Pill tone="fail">{shown}</Pill>}
        </Field>
      </Fields>
      <Button
        variant="primary"
        busy={ask.ask === "Asking"}
        disabled={fault !== undefined || ask.ask === "Asking"}
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
        <span className="lead-inquiry-asker">{inquiry.asker}</span>
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
  readonly nowMs: number;
}): ReactNode {
  const partition = props.partition;
  const client = useQueryClient();
  const list = projectListRereadNamed<LeadInquiriesResponse>(
    partition,
    "Session",
    leadInquiriesListName,
    (change) => sessionChangeKindNamed(change.resource) === inquirySessionKind,
  );
  const state = usePanelList(list, (ports) =>
    apiLeadInquiries(ports, partition),
  );
  return (
    <Panel title="Inquiries">
      {props.head === undefined ? null : (
        <LeadAsk
          partition={partition}
          onAsked={() => {
            void client.invalidateQueries({ queryKey: list.key, exact: true });
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
