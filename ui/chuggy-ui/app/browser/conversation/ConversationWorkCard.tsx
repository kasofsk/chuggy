/**
 * Everything the pod did between the ask and the answer, in one card the
 * reader opens: no work draws no card, and what there is is a timeline in the
 * order it happened.
 *
 * WHILE THE WORK GOES ON THE CARD SAYS WHAT IT IS. A page that hears its turn
 * names the thought or the tool under way, and one that does not says
 * `Working`. Once the answer is being written, or is whole, the card is no
 * longer where the work is and says what there was of it.
 */

import { Collapsible } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  conversationArgumentLine,
  conversationArgumentSummary,
  conversationArgumentText,
  conversationWorkSummary,
} from "../../core/conversation.ts";
import type {
  ConversationActivity,
  ConversationStep,
} from "../../core/conversation.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import {
  ConversationCard,
  ConversationChevron,
  conversationTriggerClassName,
} from "./ConversationCard.tsx";

import "./conversation.css";

/** Hollow while the work is over, filled and pulsing while it is not. */
function ConversationGlyph(props: { readonly running: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={
        props.running
          ? "conversation-glyph-live size-3 shrink-0"
          : "size-3 shrink-0"
      }
    >
      <circle
        cx="6"
        cy="6"
        r="4"
        fill={props.running ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

const conversationResultClassName =
  "bg-surface-2 rounded-2 max-h-(--height-clip) overflow-auto p-2 text-xs";

/** One call, its one-line argument, and the whole of what went in and came
 * back a chevron away. An error is the row's own ink: a result that failed is
 * read where the call is, not in a badge beside it. */
function ConversationToolCall(props: {
  readonly call: Extract<ConversationStep, { step: "ToolCall" }>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const call = props.call;
  const result = call.result;
  return (
    <Collapsible.Root
      className="flex flex-col gap-2"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger className={conversationTriggerClassName}>
        <code
          className={result?.isError === true ? "text-tone-fail" : "text-ink-1"}
        >
          {call.name ?? "Result"}
        </code>
        <span className="text-ink-3 wrap-anywhere min-w-0 grow text-sm">
          {conversationArgumentLine(conversationArgumentSummary(call.input))}
        </span>
        <ConversationChevron />
      </Collapsible.Trigger>
      <Collapsible.Content className="flex flex-col gap-2">
        <pre className={conversationResultClassName}>
          {conversationArgumentText(call.input)}
        </pre>
        {result === undefined ? null : (
          <pre
            className={
              result.isError
                ? `${conversationResultClassName} text-tone-fail`
                : conversationResultClassName
            }
          >
            {result.text}
          </pre>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function ConversationWorkStep(props: {
  readonly step: ConversationStep;
}): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Thinking":
      return <p className="text-ink-3 whitespace-pre-wrap">{step.text}</p>;
    case "Text":
      return <MarkdownReport text={step.text} />;
    case "ToolCall":
      return <ConversationToolCall call={step} />;
    case "Other":
      return <p className="text-ink-3 text-xs">{step.kind}</p>;
  }
}

function conversationCountWords(count: number, noun: string): string {
  return `${runCountLabel(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Whether the work is still going on in the card, which is what its glyph
 * pulses for. */
function conversationWorkUnderWay(
  running: boolean,
  activity: ConversationActivity | undefined,
): boolean {
  return (
    running &&
    activity?.activity !== "Writing" &&
    activity?.activity !== "Whole"
  );
}

/** What is under way, named the way a step of the work names it. The name's
 * own line is the tight one, so the row is as tall under it as under a word. */
function conversationActivityLabel(
  activity: ConversationActivity | undefined,
): ReactNode {
  if (activity?.activity === "Thinking") return "Thinking";
  if (activity?.activity === "ToolUse" && activity.name.length > 0)
    return <code className="text-ink-1 leading-tight">{activity.name}</code>;
  return "Working";
}

/** What the card says while closed, which is the shape of the work rather than
 * a count of everything in it. */
function conversationWorkLabel(work: readonly ConversationStep[]): string {
  const summary = conversationWorkSummary(work);
  const said = [
    ...(summary.thought ? ["Thought"] : []),
    ...(summary.toolCalls === 0
      ? []
      : [conversationCountWords(summary.toolCalls, "tool")]),
    ...(summary.texts === 0
      ? []
      : [conversationCountWords(summary.texts, "note")]),
  ];
  return said.length === 0 ? "Worked" : said.join(" · ");
}

export function ConversationWorkCard(props: {
  readonly work: readonly ConversationStep[];
  readonly running: boolean;
  /** What a running exchange is doing, where its page hears it. */
  readonly activity?: ConversationActivity | undefined;
  /** Whether the card first draws open. */
  readonly open?: boolean;
}): ReactNode {
  if (props.work.length === 0) return null;
  const underWay = conversationWorkUnderWay(props.running, props.activity);
  return (
    <ConversationCard
      label={
        underWay
          ? conversationActivityLabel(props.activity)
          : conversationWorkLabel(props.work)
      }
      glyph={<ConversationGlyph running={underWay} />}
      defaultOpen={props.open === true}
    >
      <ol className="border-edge flex flex-col gap-3 border-l pl-4">
        {props.work.map((step, at) => (
          <li key={at} className="flex flex-col gap-1">
            <ConversationWorkStep step={step} />
          </li>
        ))}
      </ol>
    </ConversationCard>
  );
}
