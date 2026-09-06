/**
 * One exchange drawn: what was asked, one disclosure for everything between,
 * and the answer.
 *
 * A TURN NOBODY HAS ANSWERED DRAWS NO ANSWER BLOCK. The parts primitive draws
 * an empty part where a running message holds no content, so the answer is
 * asked for only once there is one: an exchange still running is its standing
 * word and nothing below the ask.
 */

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  conversationArgumentSummary,
  conversationArgumentText,
  conversationWorkSummary,
} from "../../core/conversation.ts";
import type {
  ConversationArgument,
  ConversationExchange,
  ConversationMarker,
  ConversationMeasures,
  ConversationStep,
} from "../../core/conversation.ts";
import {
  costFigure,
  durationFigure,
  tokenCountFigure,
} from "../../core/figures.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { threadTurnKindWord } from "../../core/threads.ts";
import { conversationStandingArm } from "../../core/tones.ts";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Figure } from "../ui/Figure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { QuotedText } from "../ui/QuotedText.tsx";

/** What one message carries of the exchange it is half of. */
export interface ConversationCustom {
  readonly exchange: ConversationExchange;
  readonly side: "Ask" | "Answer";
}

function conversationHeld(custom: unknown): ConversationExchange | undefined {
  if (custom === null || typeof custom !== "object") return undefined;
  return (custom as Partial<ConversationCustom>).exchange;
}

function useConversationExchange(): ConversationExchange | undefined {
  return useAuiState((state) =>
    conversationHeld(state.message.metadata.custom),
  );
}

const ConversationSaid: TextMessagePartComponent = (props) => (
  <QuotedText rail="said">{props.text}</QuotedText>
);

const ConversationReport: TextMessagePartComponent = (props) => (
  <MarkdownReport text={props.text} />
);

/** One marker in the words the lead's panels already say them in. */
function ConversationMarkerLine(props: {
  readonly marker: ConversationMarker;
}): ReactNode {
  const marker = props.marker;
  switch (marker.marker) {
    case "Compaction":
      return (
        <p className="border-edge-strong border-t pt-1">
          <span className="eyebrow">Compaction</span>
        </p>
      );
    case "Elision":
      return (
        <Notice
          tone="parked"
          inline
          detail={`Elided · ${runCountLabel(marker.bytes)} bytes`}
        />
      );
    case "Capped":
      return <Notice tone="parked" inline detail={marker.sentence} />;
    case "Unreadable":
      return <Notice tone="parked" inline detail="Unreadable" />;
    case "Failure":
      return (
        <Notice tone="danger" inline detail={`Failed · ${marker.reason}`} />
      );
    case "Truncated":
      return <Notice tone="parked" inline detail="Truncated" />;
    case "Dropped":
      return (
        <Notice
          tone="parked"
          inline
          detail={`Dropped · ${runCountLabel(marker.count)}`}
        />
      );
    case "Unreached":
      return <Notice tone="parked" inline detail="Not reached" />;
    case "Unlisted":
      return <Notice tone="parked" inline detail="Stream unlisted" />;
    case "NoStore":
      return <Notice tone="parked" inline detail="No store" />;
  }
}

function ConversationMarkers(props: {
  readonly markers: readonly ConversationMarker[];
}): ReactNode {
  if (props.markers.length === 0) return null;
  return (
    <div className="grid gap-1">
      {props.markers.map((marker, at) => (
        <ConversationMarkerLine key={at} marker={marker} />
      ))}
    </div>
  );
}

/** The pointer a wake, an observation or an inquiry is drawn as, which is its
 * kind and what it is about — never the document the runtime composed. */
function ConversationPointer(props: {
  readonly kind: string;
  readonly resource?: string;
}): ReactNode {
  return (
    <p className="flex flex-wrap items-baseline gap-2">
      <span className="eyebrow">{props.kind}</span>
      {props.resource === undefined ? null : (
        <span className="num">{props.resource}</span>
      )}
    </p>
  );
}

function ConversationAskBody(props: {
  readonly exchange: ConversationExchange;
}): ReactNode {
  const ask = props.exchange.ask;
  if (ask === undefined) return null;
  switch (ask.ask) {
    case "Message":
      return <MessagePrimitive.Parts components={{ Text: ConversationSaid }} />;
    case "Wake":
      return <ConversationPointer kind={ask.wake} resource={ask.resource} />;
    case "Document":
      return <ConversationPointer kind={threadTurnKindWord(ask.kind)} />;
    case "Observation":
      return <ConversationPointer kind="Observation" />;
    case "Inquiry":
      return <ConversationPointer kind="Inquiry" />;
  }
}

/** The ask half of one exchange, with whatever the record could not draw
 * standing above it. */
export function ConversationAskMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  return (
    <MessagePrimitive.Root className="border-edge grid min-w-0 gap-2 border-t pt-2">
      <ConversationMarkers markers={exchange.before} />
      <ConversationAskBody exchange={exchange} />
    </MessagePrimitive.Root>
  );
}

function conversationArgumentLine(argument: ConversationArgument): string {
  switch (argument.argument) {
    case "Text":
      return argument.text;
    case "Size":
      return `${runCountLabel(argument.chars)} chars`;
    case "None":
      return "";
  }
}

function ConversationToolCall(props: {
  readonly call: Extract<ConversationStep, { step: "ToolCall" }>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const call = props.call;
  const result = call.result;
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      label={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <code className="text-ink-1">{call.name ?? call.id}</code>
          <span className="text-ink-3 wrap-anywhere text-sm">
            {conversationArgumentLine(conversationArgumentSummary(call.input))}
          </span>
          {result?.isError === true ? <Pill tone="fail">Error</Pill> : null}
        </span>
      }
    >
      <div className="grid min-w-0 gap-2">
        <pre className="bg-surface-2 rounded-2 overflow-auto p-2">
          {conversationArgumentText(call.input)}
        </pre>
        {result === undefined ? null : (
          <pre
            className={
              result.isError
                ? "bg-surface-2 rounded-2 text-tone-danger overflow-auto p-2"
                : "bg-surface-2 rounded-2 overflow-auto p-2"
            }
          >
            {result.text}
          </pre>
        )}
      </div>
    </Disclosure>
  );
}

function ConversationWorkStep(props: {
  readonly step: ConversationStep;
}): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Thinking":
      return (
        <>
          <span className="eyebrow">Thinking</span>
          <QuotedText>{step.text}</QuotedText>
        </>
      );
    case "Text":
      return <MarkdownReport text={step.text} />;
    case "ToolCall":
      return <ConversationToolCall call={step} />;
    case "Other":
      return <span className="eyebrow">{step.kind}</span>;
  }
}

function conversationWorkLabel(work: readonly ConversationStep[]): string {
  const summary = conversationWorkSummary(work);
  const said = [
    ...(summary.thought ? ["Thought"] : []),
    ...(summary.toolCalls === 0
      ? []
      : [`Tools · ${runCountLabel(summary.toolCalls)}`]),
    ...(summary.texts === 0 ? [] : [`Notes · ${runCountLabel(summary.texts)}`]),
  ];
  return said.length === 0 ? "Worked" : said.join(" · ");
}

/** Everything between the ask and the answer, behind one collapsed line: no
 * work draws nothing, and what there is is shown in the order it happened. */
function ConversationWork(props: {
  readonly work: readonly ConversationStep[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  if (props.work.length === 0) return null;
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      label={
        <span className="text-ink-3 text-sm">
          {conversationWorkLabel(props.work)}
        </span>
      }
    >
      <ol className="grid min-w-0 gap-3 pl-5">
        {props.work.map((step, at) => (
          <li key={at} className="grid min-w-0 gap-1">
            <ConversationWorkStep step={step} />
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

/** What the pod measured of one exchange, each absent measure said as an
 * absence, and nothing at all where no turn measured it. */
function ConversationMeasuresRow(props: {
  readonly measures: ConversationMeasures | undefined;
}): ReactNode {
  const measures = props.measures;
  if (measures === undefined) return null;
  return (
    <span className="ml-auto flex flex-wrap items-center gap-3">
      <Figure
        figure={
          measures.tokens === undefined
            ? { kind: "Absent", why: "No tokens measured" }
            : tokenCountFigure(measures.tokens)
        }
      />
      <Figure
        figure={
          measures.costMicros === undefined
            ? { kind: "Absent", why: "No cost measured" }
            : costFigure(measures.costMicros, "List")
        }
      />
      <Figure
        figure={
          measures.durationMs === undefined
            ? { kind: "Absent", why: "No duration measured" }
            : durationFigure(measures.durationMs)
        }
      />
    </span>
  );
}

/** The answer half of one exchange: where it stands, what it took, and what
 * came back. */
export function ConversationAnswerMessage(): ReactNode {
  const exchange = useConversationExchange();
  if (exchange === undefined) return null;
  const standing = exchange.standing;
  if (standing.standing === "Markers") return null;
  const arm = conversationStandingArm(standing);
  return (
    <MessagePrimitive.Root className="grid min-w-0 gap-2">
      <header className="flex flex-wrap items-center gap-3">
        <Pill tone={arm.tone}>{arm.word}</Pill>
        <ConversationMeasuresRow measures={exchange.measures} />
      </header>
      <ConversationWork work={exchange.work} />
      {standing.standing === "Failed" && standing.failure !== undefined ? (
        <Notice tone="danger" inline detail={standing.failure} />
      ) : null}
      {exchange.answer === undefined ? null : (
        <MessagePrimitive.Parts components={{ Text: ConversationReport }} />
      )}
    </MessagePrimitive.Root>
  );
}
