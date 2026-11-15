/**
 * One state as a small mark: its word in its tone, on its tone's own ground,
 * after a mark whose shape is the tone's.
 *
 * Total over `pillTones`, and no two tones share a mark, so a reader who sees
 * no colour still tells every state apart. The word is always in the document:
 * the compact form hides it from the eye and leaves it to assistive technology,
 * and the mark is decorative in both.
 */

import type { ReactNode } from "react";

import { pillTones } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";

import "./StatusBadge.css";

export const statusBadgeSizes = ["regular", "small"] as const;
export type StatusBadgeSize = (typeof statusBadgeSizes)[number];

export const statusBadgeMarks = [
  "Tick",
  "Cross",
  "Dot",
  "Half",
  "Diamond",
  "Ring",
  "Pause",
  "Slash",
  "Dash",
] as const;
export type StatusBadgeMark = (typeof statusBadgeMarks)[number];

/** The mark each tone is drawn with: one tone, one shape. */
export const statusBadgeMarkOf = {
  pass: "Tick",
  fail: "Cross",
  live: "Dot",
  evaluation: "Half",
  finalization: "Diamond",
  queued: "Ring",
  parked: "Pause",
  retired: "Slash",
  neutral: "Dash",
} as const satisfies Record<Tone, StatusBadgeMark>;

export { pillTones as statusBadgeTones };

function StatusBadgeMarkPaths(props: {
  readonly mark: StatusBadgeMark;
}): ReactNode {
  switch (props.mark) {
    case "Tick":
      return <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />;
    case "Cross":
      return <path d="M4 4 L12 12 M12 4 L4 12" />;
    case "Dot":
      return <circle cx="8" cy="8" r="4" className="status-badge-filled" />;
    case "Half":
      return (
        <>
          <circle cx="8" cy="8" r="5" />
          <path d="M8 3 A5 5 0 0 1 8 13 Z" className="status-badge-filled" />
        </>
      );
    case "Diamond":
      return (
        <path
          d="M8 2.5 L13.5 8 L8 13.5 L2.5 8 Z"
          className="status-badge-filled"
        />
      );
    case "Ring":
      return <circle cx="8" cy="8" r="5" />;
    case "Pause":
      return <path d="M6 3.5 V12.5 M10 3.5 V12.5" />;
    case "Slash":
      return (
        <>
          <circle cx="8" cy="8" r="5" />
          <path d="M4.5 11.5 L11.5 4.5" />
        </>
      );
    case "Dash":
      return <path d="M4 8 H12" />;
  }
}

export function StatusBadge(props: {
  readonly tone: Tone;
  readonly size: StatusBadgeSize;
  readonly compact?: boolean | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const mark = statusBadgeMarkOf[props.tone];
  const compact = props.compact === true;
  return (
    <span
      className="status-badge"
      data-tone={props.tone}
      data-size={props.size}
      data-compact={compact || undefined}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="status-badge-mark"
        data-mark={mark}
      >
        <StatusBadgeMarkPaths mark={mark} />
      </svg>
      <span className={compact ? "visually-hidden" : "status-badge-word"}>
        {props.children}
      </span>
    </span>
  );
}
