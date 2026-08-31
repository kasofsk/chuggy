/**
 * One status word with a mark and a tone: a verdict, a phase, a standing.
 *
 * Total over `pillTones`. The tone is chosen by `core/tones.ts` from the wire's
 * own words, so a roster the wire grows stops compiling there and never reaches
 * this as `neutral`. The mark is decorative and the word is the signal, which
 * is what lets colour carry the meaning without being the only thing that does,
 * and the face is monospace so a column of pills aligns.
 */

import type { ReactNode } from "react";

import { pillTones } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";

import "./Pill.css";

export { pillTones };
export type { Tone };

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
