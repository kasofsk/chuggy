/**
 * One status word with a mark and a tone: a verdict, a phase, a standing.
 *
 * Total over `pillTones`. The mark is decorative and the word is the signal,
 * which is what lets colour carry the meaning without being the only thing
 * that does, and the face is monospace so a column of pills aligns.
 */

import type { ReactNode } from "react";

import "./Pill.css";

export const pillTones = [
  "pass",
  "fail",
  "live",
  "queued",
  "parked",
  "retired",
  "neutral",
] as const;

export type Tone = (typeof pillTones)[number];

export function Pill(props: {
  readonly tone: Tone;
  readonly children: string;
  readonly emphasis?: boolean;
}): ReactNode {
  const emphasis = props.emphasis === true ? " pill-emphasis" : "";
  return (
    <span className={`pill pill-${props.tone}${emphasis}`}>
      <i className="pill-mark" aria-hidden="true" />
      {props.children}
    </span>
  );
}
