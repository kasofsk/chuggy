/**
 * An end to one row, asked in place before it is done: one line
 * saying what it ends, then Cancel and the danger button that does it. An
 * action that cannot be taken back is asked in `ConfirmDialog` instead. Never
 * the browser's own dialog, which halts the page, and anything driving it,
 * until it is answered. Busy is the end already sent: the danger button cannot
 * be pressed again, and there is nothing left for Cancel to take back. An end
 * that is not ready is one whose answer is still incomplete, which cannot be
 * pressed until it is.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button } from "./Button.tsx";

/** An end to one row that can be put back. */
export interface ConfirmProps {
  /** What the group is named for a reader who does not see it. */
  readonly question: string;
  readonly confirm: string;
  readonly busy: boolean;
  /** Whether what it asks for is filled in, absent where it asks for nothing. */
  readonly ready?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}

export function Confirm(props: ConfirmProps): ReactNode {
  const text = useCopyText();
  return (
    <div
      role="group"
      aria-label={props.question}
      className="border-edge grid gap-2 rounded-2 border p-3 text-left text-sm whitespace-normal"
    >
      <p className="text-ink-2 m-0">{props.children}</p>
      <div className="flex justify-end gap-2">
        {props.busy ? null : (
          <Button variant="quiet" size="sm" onClick={props.onCancel}>
            {text({ id: "ui-cancel" })}
          </Button>
        )}
        <Button
          variant="danger"
          size="sm"
          busy={props.busy}
          disabled={props.busy || props.ready === false}
          onClick={props.onConfirm}
        >
          {props.confirm}
        </Button>
      </div>
    </div>
  );
}
