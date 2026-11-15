/**
 * A text a reader carries somewhere else whole, in a box of its own: the bar
 * over it says one thing of it and holds the control that copies it.
 *
 * ALL OF IT IS DRAWN, AT ANY WIDTH. A reader checks what they are about to
 * run, so the text is wrapped inside the box and none of it is cut off or
 * behind a scroll.
 *
 * `folded` starts the box as its bar alone: the bar's chevron and what it
 * says are a Radix `Collapsible` trigger that opens the text under it and
 * closes it again, and the control beside them copies the whole text whether
 * the box is open or folded. A text a reader may copy without reading, such as
 * a prompt for their agent, is folded so it does not crowd its page.
 *
 * Total over `copyBoxBreaks`: a command breaks wherever its line ends, and a
 * text with words in it breaks between them, and inside one only where that
 * word is wider than the box.
 */

import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";

import { Chevron } from "./Chevron.tsx";
import { CopyButton } from "./CopyButton.tsx";

import "./CopyBox.css";

export const copyBoxBreaks = ["anywhere", "words"] as const;

export type CopyBoxBreak = (typeof copyBoxBreaks)[number];

const copyBoxBreakClass: Readonly<Record<CopyBoxBreak, string>> = {
  anywhere: "break-all",
  words: "wrap-anywhere",
};

const copyBoxClassName = "bg-surface-2 rounded-2 grid min-w-0";

const copyBoxBarClassName =
  "flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm text-ink-3";

interface CopyBoxProps {
  /** The one thing said of the text, beside its control. */
  readonly about: ReactNode;
  readonly text: string;
  /** What the control is called before it is pressed. */
  readonly copyLabel: string;
  readonly breaks?: CopyBoxBreak;
  /** Whether the box starts as its bar alone, the text behind it. */
  readonly folded?: boolean;
}

function CopyBoxText(props: CopyBoxProps): ReactNode {
  return (
    <code
      className={`block px-3 pb-2 font-mono text-sm text-ink-1 ${copyBoxBreakClass[props.breaks ?? "anywhere"]}`}
    >
      {props.text}
    </code>
  );
}

function CopyBoxFolded(props: CopyBoxProps): ReactNode {
  return (
    <Collapsible.Root className={copyBoxClassName}>
      <div className={copyBoxBarClassName}>
        <Collapsible.Trigger className="copy-box-trigger">
          <Chevron className="copy-box-chevron" />
          <span className="min-w-0">{props.about}</span>
        </Collapsible.Trigger>
        <CopyButton text={props.text} label={props.copyLabel} worded />
      </div>
      <Collapsible.Content>
        <CopyBoxText {...props} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function CopyBox(props: CopyBoxProps): ReactNode {
  if (props.folded === true) return <CopyBoxFolded {...props} />;
  return (
    <div className={copyBoxClassName}>
      <div className={copyBoxBarClassName}>
        <span className="min-w-0">{props.about}</span>
        <CopyButton text={props.text} label={props.copyLabel} worded />
      </div>
      <CopyBoxText {...props} />
    </div>
  );
}
