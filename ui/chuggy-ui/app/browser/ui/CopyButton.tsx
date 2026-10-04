/**
 * The control that copies what it is beside: a mark to press, and a tick with
 * one word once the clipboard has it.
 *
 * THE WORD IS SAID, AND SHOWN ONLY WHERE THERE IS ROOM FOR IT. It is a status
 * a screen reader hears either way; `worded` draws it beside the mark, which a
 * code block's own bar has the room for and the line under an answer does not.
 *
 * NOTHING IS CLAIMED THE BROWSER DID NOT DO. The tick is drawn once the write
 * answers that it happened, and a write that was refused leaves the control as
 * it was.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useCopyHeld } from "./copyHeld.tsx";

import "./CopyButton.css";

/** How long the control says it copied before it offers to again. */
export const copySaidMilliseconds = 2000;

function CopyMark(props: { readonly copied: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="copy-mark">
      {props.copied ? (
        <path d="M3 8.5 L6.5 12 L13 4.5" />
      ) : (
        <>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5 V3 A1.5 1.5 0 0 0 9 1.5 H3 A1.5 1.5 0 0 0 1.5 3 V9 A1.5 1.5 0 0 0 3 10.5 H3.5" />
        </>
      )}
    </svg>
  );
}

export function CopyButton(props: {
  /** What is copied, read when the control is pressed. */
  readonly text: string;
  /** What the control is called before it is pressed. */
  readonly label: string;
  readonly worded?: boolean;
}): ReactNode {
  const write = useCopyHeld();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  if (write === undefined) return null;
  const copy = async (): Promise<void> => {
    if (!(await write(props.text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, copySaidMilliseconds);
  };
  return (
    <span className="copy">
      <span
        role="status"
        className={props.worded === true ? "copy-said" : "visually-hidden"}
      >
        {copied ? "Copied" : ""}
      </span>
      <button
        type="button"
        className="copy-button"
        aria-label={props.label}
        onClick={() => void copy()}
      >
        <CopyMark copied={copied} />
      </button>
    </span>
  );
}
