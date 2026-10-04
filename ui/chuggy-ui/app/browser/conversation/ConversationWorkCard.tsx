/**
 * The work between two of an answer's texts, behind one line: however many
 * steps it took it is one line where it happened, and what it opens to is a
 * timeline in the order they did.
 *
 * WHILE THE WORK GOES ON THE LINE SAYS SO. A page that hears its turn names
 * the thought or the tool under way and counts its seconds from when it first
 * drew it; where nothing names the step, the line says the turn is working.
 * Once something is written after it, or the turn is whole, the line says what
 * there was of it and no time, since the record holds none and reads the same
 * when it is read again.
 *
 * IT IS A CONTROL ONLY WHERE IT OPENS TO SOMETHING. A thought the record keeps
 * no words of and a call nothing is held of yet have nothing behind them, so
 * the line of a part made only of those is a line and no more.
 *
 * IT IS A LINE AND NOT A BOX, as tall as a line of the text around it, so the
 * engine giving way to it moves nothing.
 */

import { Collapsible } from "radix-ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  conversationArgumentLine,
  conversationArgumentSummary,
  conversationArgumentText,
  conversationWorkSummary,
} from "../../core/conversation.ts";
import type {
  ConversationWorkActivity,
  ConversationWorkStep,
} from "../../core/conversation.ts";
import { durationText } from "../../core/figures.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import {
  ConversationChevron,
  ConversationGlyph,
  conversationTriggerClassName,
} from "./ConversationCard.tsx";

import "./conversation.css";

type ConversationToolCallStep = Extract<
  ConversationWorkStep,
  { step: "ToolCall" }
>;

const conversationResultClassName =
  "bg-surface-2 rounded-2 max-h-(--height-clip) overflow-auto p-2 text-xs";

/** The row a call is named on: its name, in the failed ink where its result
 * failed, and its one-line argument. */
function ConversationToolCallNamed(props: {
  readonly call: ConversationToolCallStep;
}): ReactNode {
  const call = props.call;
  return (
    <>
      <code
        className={
          call.result?.isError === true ? "text-tone-fail" : "text-ink-1"
        }
      >
        {call.name ?? "Result"}
      </code>
      <span className="text-ink-3 wrap-anywhere min-w-0 grow text-sm">
        {conversationArgumentLine(conversationArgumentSummary(call.input))}
      </span>
    </>
  );
}

/** One call, its one-line argument, and the whole of what went in and came
 * back a chevron away. An error is the row's own ink: a result that failed is
 * read where the call is, not in a badge beside it. A call nothing is held of
 * but its name is that name and no control. */
function ConversationToolCall(props: {
  readonly call: ConversationToolCallStep;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const call = props.call;
  const result = call.result;
  if (call.input === undefined && result === undefined)
    return (
      <div className="flex min-w-0 items-center gap-2">
        <ConversationToolCallNamed call={call} />
      </div>
    );
  return (
    <Collapsible.Root
      className="flex flex-col gap-2"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger className={conversationTriggerClassName}>
        <ConversationToolCallNamed call={call} />
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

function ConversationWorkStepDrawn(props: {
  readonly step: ConversationWorkStep;
}): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Thinking":
      return <p className="text-ink-3 whitespace-pre-wrap">{step.text}</p>;
    case "ToolCall":
      return <ConversationToolCall call={step} />;
    case "Other":
      return <p className="text-ink-3 text-xs">{step.kind}</p>;
  }
}

/** Whether a step has anything to draw behind the line, which a thought with
 * no words kept of it has not. */
function conversationWorkStepSays(step: ConversationWorkStep): boolean {
  return step.step !== "Thinking" || step.text.length > 0;
}

function conversationCountWords(count: number, noun: string): string {
  return `${runCountLabel(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the line says once the work is over, which is the shape of the work
 * rather than a count of everything in it. */
function conversationWorkLabel(steps: readonly ConversationWorkStep[]): string {
  const summary = conversationWorkSummary(steps);
  const said = [
    ...(summary.thought ? ["Thought"] : []),
    ...(summary.toolCalls === 0
      ? []
      : [conversationCountWords(summary.toolCalls, "tool")]),
  ];
  return said.length === 0 ? "Worked" : said.join(" · ");
}

/** What is under way, named the way a step of the work names it. The name's
 * own line is the tight one, so the row is as tall under it as under a word. */
function conversationActivityLabel(
  activity: ConversationWorkActivity | undefined,
): ReactNode {
  if (activity?.activity === "Thinking") return "Thinking";
  if (activity !== undefined && activity.name.length > 0)
    return <code className="text-ink-1 leading-tight">{activity.name}</code>;
  return "Working";
}

const conversationSecondMs = 1000;

/** How long the step under way has been: counted from when this first drew
 * it, and from nothing again for each step that begins. */
function useConversationStepElapsedMs(step: number | undefined): number {
  const [elapsed, setElapsed] = useState<
    { readonly step: number; readonly ms: number } | undefined
  >(undefined);
  useEffect(() => {
    if (step === undefined) return undefined;
    const beganMs = Date.now();
    const ticking = setInterval(() => {
      setElapsed({ step, ms: Date.now() - beganMs });
    }, conversationSecondMs);
    return () => {
      clearInterval(ticking);
    };
  }, [step]);
  return elapsed !== undefined && elapsed.step === step ? elapsed.ms : 0;
}

/** The part of the work a turn is still at, and the step of it the turn is
 * heard to be on where anything says. */
export interface ConversationWorkUnderWay {
  readonly activity: ConversationWorkActivity | undefined;
}

/** The words of the line: what is under way, and for how long once a step
 * that is named has lasted a second, or what there was. */
function conversationWorkWords(
  steps: readonly ConversationWorkStep[],
  underWay: ConversationWorkUnderWay | undefined,
  elapsedMs: number,
): ReactNode {
  if (underWay === undefined)
    return <span className="min-w-0">{conversationWorkLabel(steps)}</span>;
  return (
    <>
      <span className="min-w-0">
        {conversationActivityLabel(underWay.activity)}
      </span>
      {elapsedMs < conversationSecondMs ? null : (
        <span className="num">{durationText(elapsedMs)}</span>
      )}
    </>
  );
}

const conversationWorkLineClassName =
  "conversation-work-line text-ink-3 flex w-full min-w-0 items-center gap-2 text-sm";

export function ConversationWorkCard(props: {
  readonly steps: readonly ConversationWorkStep[];
  /** Set where the work is still going on. */
  readonly underWay?: ConversationWorkUnderWay | undefined;
  /** Whether its glyph is the one thing on the surface that moves. */
  readonly live?: boolean;
  /** Whether the card first draws open. */
  readonly open?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(props.open === true);
  const said = props.steps.filter(conversationWorkStepSays);
  const glyph = (
    <ConversationGlyph
      filled={props.underWay !== undefined}
      live={props.underWay !== undefined && props.live === true}
    />
  );
  const elapsedMs = useConversationStepElapsedMs(
    props.underWay?.activity === undefined ? undefined : props.steps.length,
  );
  const words = conversationWorkWords(props.steps, props.underWay, elapsedMs);
  if (said.length === 0)
    return (
      <div className={conversationWorkLineClassName}>
        {glyph}
        {words}
      </div>
    );
  return (
    <Collapsible.Root
      className="flex flex-col gap-3 text-sm"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger
        className={`conversation-trigger ${conversationWorkLineClassName}`}
      >
        {glyph}
        {words}
        <ConversationChevron />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ol className="border-edge flex flex-col gap-3 border-l pl-4">
          {said.map((step, at) => (
            <li key={at} className="flex flex-col gap-1">
              <ConversationWorkStepDrawn step={step} />
            </li>
          ))}
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
