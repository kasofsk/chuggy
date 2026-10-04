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
 * by class and once `markdownSyntax.ts` has the grammars. The characters are
 * the same either way, so what is copied, and where the mark sits, do not
 * depend on it.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";

import { CopyButton } from "./CopyButton.tsx";
import {
  markdownSyntaxCharsMax,
  markdownSyntaxLanguage,
  useMarkdownSyntax,
} from "./markdownSyntax.ts";
import type { MarkdownSyntaxNode } from "./markdownSyntax.ts";
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

/** The runs a block of code is coloured as, or nothing while it is drawn as
 * its characters. */
function useMarkdownCodeRuns(
  code: MarkdownNodeOf<"code">,
): readonly MarkdownSyntaxNode[] | undefined {
  const language = markdownSyntaxLanguage(code.lang ?? "");
  const read = useMarkdownSyntax(language);
  const value = code.value;
  return useMemo(
    () =>
      language === undefined || value.length > markdownSyntaxCharsMax
        ? undefined
        : read?.(value, language),
    [read, language, value],
  );
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
  const runs = useMarkdownCodeRuns(props.code);
  return (
    <div className="run-report-code">
      <div className="run-report-code-bar">
        <span className="run-report-code-language">{language}</span>
        <CopyButton text={props.code.value} label="Copy code" worded />
      </div>
      <pre>
        <code className={props.className}>
          {runs === undefined ? (
            props.code.value
          ) : (
            <MarkdownSyntaxRuns nodes={runs} />
          )}
        </code>
      </pre>
    </div>
  );
}
