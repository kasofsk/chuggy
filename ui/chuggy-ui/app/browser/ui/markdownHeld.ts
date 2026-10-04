/**
 * What a report is handed that a primitive may not reach for: the time, and
 * the worker that colours its code.
 *
 * A PRIMITIVE PERFORMS NOTHING, and reading a clock or starting a worker is
 * something performed, so both arrive here from whoever mounts the console.
 * They sit where a report cannot be handed anything: under an answer, a run's
 * summary, a note in a card.
 *
 * BOTH ARE OPTIONAL, AND A REPORT WITH NEITHER IS STILL A REPORT. Mounted with
 * no provider, the time never moves, so every reading is taken whole, and
 * code is drawn as its characters and never coloured.
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { MarkdownClock } from "./markdownReading.ts";
import { markdownSyntaxDesk } from "./markdownSyntax.ts";
import type {
  MarkdownSyntaxDesk,
  MarkdownSyntaxOpen,
} from "./markdownSyntax.ts";

/** What a report draws with. */
export interface MarkdownHeld {
  /** The time, or nothing where it is not told. */
  readonly clock: MarkdownClock | undefined;
  /** What has code read into its colours, or nothing where nothing does. */
  readonly syntax: MarkdownSyntaxDesk | undefined;
}

const markdownHeldNothing: MarkdownHeld = {
  clock: undefined,
  syntax: undefined,
};

const markdownContext = createContext<MarkdownHeld>(markdownHeldNothing);

/**
 * Hands every report under it a clock and one desk over the workers `syntax`
 * starts. Both are taken as they are when this is first drawn, and the desk's
 * worker is ended when this is no longer drawn.
 */
export function MarkdownProvider(props: {
  /** Milliseconds that never go back. */
  readonly clock: MarkdownClock;
  readonly syntax: MarkdownSyntaxOpen;
  readonly children: ReactNode;
}): ReactNode {
  const [held] = useState<MarkdownHeld>(() => ({
    clock: props.clock,
    syntax: markdownSyntaxDesk(props.syntax, props.clock),
  }));
  const desk = held.syntax;
  useEffect(
    () => () => {
      desk?.end();
    },
    [desk],
  );
  return createElement(
    markdownContext.Provider,
    { value: held },
    props.children,
  );
}

export function useMarkdownHeld(): MarkdownHeld {
  return useContext(markdownContext);
}
