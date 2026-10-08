/**
 * One status word with a mark and a tone: a verdict, a phase, a standing.
 *
 * Total over `pillTones`. The tone is chosen by `core/tones.ts` from the wire's
 * own words, so a roster the wire grows stops compiling there and never reaches
 * this as `neutral`. The mark is decorative and the word is the signal, so the
 * chip reads the same to someone who sees no colour in it at all.
 *
 * Children is a node rather than a string alone so a value too long for its
 * column can clip inside the chip itself — one node wrapped, rather than a
 * chip and a second, differently-shaped clipped span beside it.
 */

import type { ReactNode } from "react";

import { pillTones } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";

import "./Pill.css";

export { pillTones };
export type { Tone };

interface PillLook {
  readonly tone: Tone;
  readonly emphasis?: boolean | undefined;
}

/** The pill's look as a class name, for a primitive drawn as one. */
export function pillLookClassName(look: PillLook): string {
  const emphasis = look.emphasis === true ? " pill-emphasis" : "";
  return `pill pill-${look.tone}${emphasis}`;
}

export function Pill(
  props: PillLook & { readonly children: ReactNode },
): ReactNode {
  return (
    <span className={pillLookClassName(props)}>
      <i className="pill-mark" aria-hidden="true" />
      {props.children}
    </span>
  );
}
