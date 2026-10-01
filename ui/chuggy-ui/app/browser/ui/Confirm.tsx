/**
 * An end that cannot be undone, asked in place before it is done: one line
 * saying what it ends, then Cancel and the danger button that does it. Never
 * the browser's own dialog, which halts the page, and anything driving it,
 * until it is answered. Busy is the end already sent: the danger button cannot
 * be pressed again, and there is nothing left for Cancel to take back.
 */

import type { ReactNode } from "react";

import { Button } from "./Button.tsx";

export function Confirm(props: {
  /** What the group is named for a reader who does not see it. */
  readonly question: string;
  readonly confirm: string;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}): ReactNode {
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
            Cancel
          </Button>
        )}
        <Button
          variant="danger"
          size="sm"
          busy={props.busy}
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          {props.confirm}
        </Button>
      </div>
    </div>
  );
}
