/**
 * A text a reader carries somewhere else whole, in a box of its own: the bar
 * over it says one thing of it and holds the control that copies it.
 *
 * ALL OF IT IS DRAWN, AT ANY WIDTH. A reader checks what they are about to
 * run, so the text is wrapped inside the box and none of it is cut off or
 * behind a scroll.
 *
 * Total over `copyBoxBreaks`: a command breaks wherever its line ends, and a
 * text with words in it breaks between them, and inside one only where that
 * word is wider than the box.
 */

import type { ReactNode } from "react";

import { CopyButton } from "./CopyButton.tsx";

export const copyBoxBreaks = ["anywhere", "words"] as const;

export type CopyBoxBreak = (typeof copyBoxBreaks)[number];

const copyBoxBreakClass: Readonly<Record<CopyBoxBreak, string>> = {
  anywhere: "break-all",
  words: "wrap-anywhere",
};

export function CopyBox(props: {
  /** The one thing said of the text, beside its control. */
  readonly about: ReactNode;
  readonly text: string;
  /** What the control is called before it is pressed. */
  readonly copyLabel: string;
  readonly breaks?: CopyBoxBreak;
}): ReactNode {
  return (
    <div className="bg-surface-2 rounded-2 grid min-w-0">
      <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm text-ink-3">
        <span className="min-w-0">{props.about}</span>
        <CopyButton text={props.text} label={props.copyLabel} worded />
      </div>
      <code
        className={`px-3 pb-2 font-mono text-sm text-ink-1 ${copyBoxBreakClass[props.breaks ?? "anywhere"]}`}
      >
        {props.text}
      </code>
    </div>
  );
}
