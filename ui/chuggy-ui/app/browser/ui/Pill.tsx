/**
 * One status word with a mark and a tone: a verdict, a phase, a standing.
 *
 * Total over `pillTones`. The tone is chosen by `core/tones.ts` from the wire's
 * own words, so a roster the wire grows stops compiling there and never reaches
 * this as `neutral`. The mark is decorative and the word is the signal, so the
 * chip reads the same to someone who sees no colour in it at all.
 *
 * CHILDREN IS A NODE, NOT JUST A STRING, so a chip whose value must still clip
 * — a runs-on tag carrying an image reference — can nest the clipping span
 * inside the chip rather than invent a second kind of tag that clips outside
 * one.
 */

import type { ReactNode } from "react";

import { pillTones } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";

import "./Pill.css";

export { pillTones };
export type { Tone };

export function Pill(props: {
  readonly tone: Tone;
  readonly children: ReactNode;
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
