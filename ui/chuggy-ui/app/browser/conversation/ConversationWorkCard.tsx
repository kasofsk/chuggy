/**
 * Everything the pod did between the ask and the answer, in one card the
 * reader opens: no work draws no card, and what there is is a timeline in the
 * order it happened.
 */

import { Collapsible } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  conversationArgumentSummary,
  conversationArgumentText,
  conversationWorkSummary,
} from "../../core/conversation.ts";
import type {
  ConversationArgument,
  ConversationStep,
} from "../../core/conversation.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";

import "./conversation.css";

/** A button carries the browser's own box until something takes it off, and
 * this surface's triggers are rows rather than controls to press. */
const conversationTriggerClassName =
  "conversation-trigger flex w-full min-w-0 items-center gap-2";

function ConversationChevron(): ReactNode {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="conversation-chevron size-3 shrink-0"
    >
      <path
        d="M4 2 L8 6 L4 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

const conversationResultClassName =
  "bg-surface-2 rounded-2 overflow-auto p-2 text-xs";

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
      className="grid min-w-0 gap-2"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger className={conversationTriggerClassName}>
        <code
          className={result?.isError === true ? "text-tone-fail" : "text-ink-1"}
        >
          {call.name ?? call.id}
        </code>
        <span className="text-ink-3 wrap-anywhere min-w-0 grow text-sm">
          {conversationArgumentLine(conversationArgumentSummary(call.input))}
        </span>
        <ConversationChevron />
      </Collapsible.Trigger>
      <Collapsible.Content className="grid min-w-0 gap-2">
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

/** What the card says while closed, which is the shape of the work rather than
 * a count of everything in it. */
function conversationWorkLabel(
  work: readonly ConversationStep[],
  running: boolean,
): string {
  if (running) return "Working";
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
}): ReactNode {
  const [open, setOpen] = useState(false);
  if (props.work.length === 0) return null;
  return (
    <Collapsible.Root
      className="bg-surface-1 border-edge rounded-3 grid min-w-0 gap-3 border p-3"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger
        className={`${conversationTriggerClassName} text-ink-3 text-sm`}
      >
        <ConversationGlyph running={props.running} />
        <span className="min-w-0 grow">
          {conversationWorkLabel(props.work, props.running)}
        </span>
        <ConversationChevron />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ol className="border-edge grid min-w-0 gap-3 border-l pl-4">
          {props.work.map((step, at) => (
            <li key={at} className="grid min-w-0 gap-1">
              <ConversationWorkStep step={step} />
            </li>
          ))}
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
