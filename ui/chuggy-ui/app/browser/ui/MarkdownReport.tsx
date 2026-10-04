/**
 * A model's text drawn as the report it is: a worker's report on a run, an
 * agent's answer in a thread, a note in a card.
 *
 * WHAT IS DRAWN IS A READING, AND A READING IS KEPT. `markdownReading.ts` reads
 * a text a block at a time, so a text that grows by a few characters a frame
 * is parsed and drawn in its last block only. The reading is held between
 * renders by the component under the one a caller mounts, so the one a caller
 * mounts is drawn once for each text it is handed.
 *
 * A TEXT STILL BEING WRITTEN IS DRAWN BY WHAT DRAWS A FINISHED ONE. `writing`
 * changes the text that is read — the marks its last block leaves open are
 * closed — and puts the mark's class on the last thing written. It changes no
 * element, so the moment a text is whole changes nothing a reader can see.
 *
 * WHILE A TEXT IS BEING WRITTEN EXACTLY ONE THING IN IT CARRIES THE MARK. Where
 * the last block can carry it, that block does; where nothing can — no block
 * yet, or a rule — the report itself does, and a caller that pulses the mark
 * never has a text being written with nothing pulsing in it.
 *
 * A TEXT THAT IS DEAR TO READ IS DRAWN A STEP BEHIND ITS WRITER. Where the
 * reading says it has stopped short or is resting, what it holds is drawn and
 * the report draws itself again when the rest is over, so the page answers a
 * reader between the steps.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  MarkdownBlockDrawn,
  MarkdownInlineRun,
  markdownMarkCarried,
  markdownMarkClassName,
} from "./MarkdownBlocks.tsx";
import { useMarkdownHeld } from "./markdownHeld.ts";
import {
  markdownReadingCurrent,
  markdownReadingNext,
} from "./markdownReading.ts";
import type { MarkdownReading } from "./markdownReading.ts";
import { markdownLineJoined, markdownLineRead } from "./markdownTree.ts";

import "./MarkdownReport.css";

interface MarkdownReportProps {
  readonly text: string;
  /** Whether the report gives up the panel it draws itself in, for a column
   * with no width to spare. */
  readonly bare?: boolean;
  /** Whether more of the text is still coming, so a mark its last block leaves
   * open is drawn as what it is about to be. */
  readonly writing?: boolean;
}

/** The longest a report waits before it reads a text again, in
 * milliseconds. */
export const markdownReportWaitMaxMs = 1_000;

/**
 * A text read, going on from the reading this component last made of it, and
 * taken again when the rest of a reading that is not all of the text is over.
 * Setting state while rendering is how React is told a value derived from
 * props moved: it draws again at once, with the reading already made.
 */
function useMarkdownReading(text: string, writing: boolean): MarkdownReading {
  const clock = useMarkdownHeld().clock;
  const [held, setHeld] = useState(() =>
    markdownReadingNext(undefined, text, writing, clock),
  );
  const [woken, setWoken] = useState(0);
  const next = markdownReadingNext(held, text, writing, clock);
  if (next !== held) setHeld(next);
  const waits = !markdownReadingCurrent(next, text, writing);
  useEffect(() => {
    if (!waits || clock === undefined) return undefined;
    const wait = Math.min(
      Math.max(next.until - clock(), 0),
      markdownReportWaitMaxMs,
    );
    const timer = setTimeout(() => {
      setWoken((count) => count + 1);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [waits, next, clock, woken]);
  return next;
}

function markdownReportClassName(bare: boolean, mark: boolean): string {
  return [
    "run-report",
    ...(bare ? ["run-report-bare"] : []),
    ...(mark ? [markdownMarkClassName] : []),
  ].join(" ");
}

function MarkdownReportRead(props: MarkdownReportProps): ReactNode {
  const reading = useMarkdownReading(props.text, props.writing === true);
  const { settled, open, writing } = reading;
  const above = useMemo(
    () =>
      settled.map((block, at) => (
        <MarkdownBlockDrawn key={at} block={block} depth={0} mark={false} />
      )),
    [settled],
  );
  const last = open.at(-1);
  const carried = writing && last !== undefined && markdownMarkCarried(last);
  const below = open.map((block, at) => (
    <MarkdownBlockDrawn
      key={settled.length + at}
      block={block}
      depth={0}
      mark={carried && at === open.length - 1}
    />
  ));
  return (
    <div
      className={markdownReportClassName(
        props.bare === true,
        writing && !carried,
      )}
    >
      {[...above, ...below]}
    </div>
  );
}

/** The text laid out as the markdown its writer tends to write. */
export function MarkdownReport(props: MarkdownReportProps): ReactNode {
  return <MarkdownReportRead {...props} />;
}

/**
 * One line of a writer's prose with its marks, for a place that draws a line
 * rather than a report. No block is read in it, so whatever it opens with it
 * is words, marks and references; only a line past what `markdownTree.ts` will
 * read is drawn as it was written.
 */
export function MarkdownLine(props: { readonly text: string }): ReactNode {
  const line = useMemo(() => markdownLineJoined(props.text), [props.text]);
  const read = useMemo(() => markdownLineRead(line), [line]);
  if (read === undefined) return line;
  return <MarkdownInlineRun nodes={read} depth={0} linked={false} />;
}
