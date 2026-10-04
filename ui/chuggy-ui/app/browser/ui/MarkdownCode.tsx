/**
 * A block of code as a panel: its own ground, the language it was fenced as
 * said quietly above it, and a control that copies it.
 *
 * A LONG LINE SCROLLS INSIDE THE PANEL. Code is not wrapped, because where a
 * line breaks is part of what it says, and the panel is what scrolls so the
 * column around it keeps its width.
 *
 * THE BAR IS THERE WHETHER OR NOT A LANGUAGE WAS NAMED, so a block being
 * written does not change height when its fence's line ends and the language
 * is known.
 *
 * CODE IN A LANGUAGE THE FENCE NAMES IS COLOURED BY WHAT EACH RUN OF IT IS,
 * by class and once `markdownSyntax.ts` has had it read. It is drawn as its
 * characters until then, and the characters are the same either way, so what
 * is copied, and where the mark sits, do not depend on it.
 *
 * A BLOCK THAT HAS GROWN SINCE IT WAS READ KEEPS THE COLOURS OF WHAT WAS READ.
 * The reading is of a text the block still begins with, so its runs are drawn
 * and what was written after them follows as characters until the next
 * reading comes; a reading of a text the block no longer begins with is
 * dropped.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CopyButton } from "./CopyButton.tsx";
import { useMarkdownHeld } from "./markdownHeld.ts";
import { markdownSyntaxLanguage } from "./markdownSyntax.ts";
import type {
  MarkdownSyntaxNode,
  MarkdownSyntaxReading,
  MarkdownSyntaxSeat,
} from "./markdownSyntax.ts";
import type { MarkdownNodeOf } from "./markdownTree.ts";

/** The most of a fence's language word the bar shows. */
export const markdownCodeLanguageCharsMax = 24;

function MarkdownSyntaxRuns(props: {
  readonly nodes: readonly MarkdownSyntaxNode[];
}): ReactNode {
  return props.nodes.map((node, at) =>
    typeof node === "string" ? (
      node
    ) : (
      <span key={at} className={node.scope === "" ? undefined : node.scope}>
        <MarkdownSyntaxRuns nodes={node.children} />
      </span>
    ),
  );
}

/**
 * The last reading of a block of code that it still begins with, or nothing
 * while it is drawn as its characters. The block keeps one place at the desk
 * for as long as it is drawn, and asks again each time its text moves.
 */
function useMarkdownCodeReading(
  code: MarkdownNodeOf<"code">,
): MarkdownSyntaxReading | undefined {
  const desk = useMarkdownHeld().syntax;
  const language = markdownSyntaxLanguage(code.lang ?? "");
  const value = code.value;
  const [reading, setReading] = useState<MarkdownSyntaxReading>();
  const seat = useRef<MarkdownSyntaxSeat>(undefined);
  useEffect(() => {
    const taken = desk?.seat(setReading);
    seat.current = taken;
    return () => {
      seat.current = undefined;
      taken?.leave();
    };
  }, [desk]);
  useEffect(() => {
    if (language !== undefined) seat.current?.ask(value, language);
  }, [desk, language, value]);
  if (reading === undefined || reading.language !== language) return undefined;
  return value.startsWith(reading.code) ? reading : undefined;
}

export function MarkdownCode(props: {
  readonly code: MarkdownNodeOf<"code">;
  /** The class its lines carry, which is how a caller marks the last thing
   * written. */
  readonly className: string | undefined;
}): ReactNode {
  const language = (props.code.lang ?? "").slice(
    0,
    markdownCodeLanguageCharsMax,
  );
  const reading = useMarkdownCodeReading(props.code);
  const runs = useMemo(
    () =>
      reading === undefined ? undefined : (
        <MarkdownSyntaxRuns nodes={reading.runs} />
      ),
    [reading],
  );
  return (
    <div className="run-report-code">
      <div className="run-report-code-bar">
        <span className="run-report-code-language">{language}</span>
        <CopyButton text={props.code.value} label="Copy code" worded />
      </div>
      <pre>
        <code className={props.className}>
          {runs}
          {props.code.value.slice(reading?.code.length ?? 0)}
        </code>
      </pre>
    </div>
  );
}
