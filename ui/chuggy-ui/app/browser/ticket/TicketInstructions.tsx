/**
 * What the ticket asks for: the brief's intent as markdown, folded to its
 * first lines with a fade and opened by a toggle under it that is drawn only
 * where the text runs longer; under that the brief's images. Whatever the
 * caller hands as its aside sits at the right of the heading.
 *
 * Opening and closing slide the height unless the reader asks for reduced
 * motion, which the stylesheet turns into a zero duration.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { TicketBriefImages } from "../TicketProvenance.tsx";
import { Button } from "../ui/Button.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

import "./ticket.css";

/** Whether the text runs past the folded height: its content is taller than
 * the box that shows it. */
export function instructionsOverflow(
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight > clientHeight + 1;
}

/** What a folded body is measured by: whether it overflows. */
export type InstructionsMeasure = (element: HTMLElement) => boolean;

const measured: InstructionsMeasure = (element) =>
  instructionsOverflow(element.scrollHeight, element.clientHeight);

/** Slides the body between the height it had and the one it now has. */
function slide(element: HTMLElement, from: number, to: number): () => void {
  element.style.transition = "none";
  element.style.maxHeight = `${String(from)}px`;
  void element.offsetHeight;
  element.style.transition = "";
  element.classList.add("sliding");
  element.style.maxHeight = `${String(to)}px`;
  const settle = (): void => {
    element.classList.remove("sliding");
    element.style.maxHeight = "";
  };
  if (!(parseFloat(getComputedStyle(element).transitionDuration) > 0)) {
    settle();
    return () => undefined;
  }
  const ended = (event: TransitionEvent): void => {
    if (event.target === element && event.propertyName === "max-height")
      settle();
  };
  element.addEventListener("transitionend", ended);
  return () => {
    element.removeEventListener("transitionend", ended);
    settle();
  };
}

/** Slides the body from the height it had when the toggle was pressed. */
function useSlid(
  bodyRef: RefObject<HTMLDivElement | null>,
  fromRef: RefObject<number | undefined>,
  open: boolean,
): void {
  useLayoutEffect(() => {
    const element = bodyRef.current;
    const start = fromRef.current;
    fromRef.current = undefined;
    if (element === null || start === undefined) return;
    return slide(
      element,
      start,
      open ? element.scrollHeight : element.clientHeight,
    );
  }, [bodyRef, fromRef, open]);
}

/** The intent folded to its first lines, and the toggle under it where it
 * runs longer. The body is named `bodyId`, which the toggle controls. */
export function IntentFolded(props: {
  readonly text: string;
  readonly bodyId: string;
  readonly measure?: InstructionsMeasure;
}): ReactNode {
  const { text, bodyId } = props;
  const measure = props.measure ?? measured;
  const body = useRef<HTMLDivElement>(null);
  const from = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const copyText = useCopyText();
  useLayoutEffect(() => {
    const element = body.current;
    if (element === null || open) return;
    setLong(measure(element));
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      setLong(measure(element));
    });
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, [text, measure, open]);
  useSlid(body, from, open);
  return (
    <>
      <div
        id={bodyId}
        ref={body}
        className="ticket-instructions-body"
        data-open={open}
        data-faded={long && !open}
      >
        <MarkdownReport text={text} bare />
      </div>
      {long || open ? (
        <Button
          size="sm"
          expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            from.current = body.current?.getBoundingClientRect().height;
            setOpen(!open);
          }}
        >
          {copyText({
            id: open
              ? "ticket-instructions-show-less"
              : "ticket-instructions-show-all",
          })}
        </Button>
      ) : null}
    </>
  );
}

/** The title row and the intent folded under it. */
function InstructionsIntent(props: {
  readonly text: string | undefined;
  readonly measure: InstructionsMeasure;
  readonly aside: ReactNode;
}): ReactNode {
  const copyText = useCopyText();
  return (
    <>
      <div className="ticket-instructions-head">
        <h2
          className="ticket-instructions-title"
          id="ticket-instructions-title"
        >
          {copyText({ id: "ticket-instructions-title" })}
        </h2>
        {props.aside}
      </div>
      {props.text === undefined ? null : (
        <IntentFolded
          text={props.text}
          bodyId="ticket-instructions-body"
          measure={props.measure}
        />
      )}
    </>
  );
}

export function TicketInstructions(props: {
  readonly partition: PartitionIdentity;
  readonly brief: TicketResponse["brief"];
  /** How the folded text is told to overflow; the layout's own unless a test supplies one. */
  readonly measure?: InstructionsMeasure;
  /** What sits at the right of the heading. */
  readonly aside?: ReactNode;
}): ReactNode {
  const intent = props.brief?.intent;
  return (
    <section
      id="ticket-instructions"
      className="ticket-instructions"
      aria-labelledby="ticket-instructions-title"
    >
      <InstructionsIntent
        key={intent}
        text={intent === undefined || intent === "" ? undefined : intent}
        measure={props.measure ?? measured}
        aside={props.aside}
      />
      <TicketBriefImages partition={props.partition} brief={props.brief} />
    </section>
  );
}
