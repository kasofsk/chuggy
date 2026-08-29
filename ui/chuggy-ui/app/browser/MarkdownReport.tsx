/**
 * A work report drawn as the blocks `markdownReport.ts` reads it into, rather
 * than the marked-up text a worker actually wrote. No mark ever becomes raw
 * HTML: every node is its own React element, so a report is never a place a
 * worker's own words could inject a script into the screen reading them.
 */

import { Fragment } from "react";
import type { ReactNode } from "react";

import {
  markdownReportBlocks,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownLines,
} from "../core/markdownReport.ts";

function MarkdownInlineRun(props: {
  readonly nodes: readonly MarkdownInline[];
}): ReactNode {
  return props.nodes.map((node, at) => {
    switch (node.kind) {
      case "Text":
        return node.text;
      case "Bold":
        return <strong key={at}>{node.text}</strong>;
      case "Italic":
        return <em key={at}>{node.text}</em>;
      case "Code":
        return <code key={at}>{node.text}</code>;
      case "Link":
        return (
          <a key={at} href={node.href} target="_blank" rel="noreferrer">
            {node.text}
          </a>
        );
    }
  });
}

/** Consecutive lines within one block, a line break between each — the mark
 * a worker's own newline leaves on the screen. */
function MarkdownLineRun(props: { readonly lines: MarkdownLines }): ReactNode {
  return props.lines.map((line, at) => (
    <Fragment key={at}>
      {at > 0 ? <br /> : null}
      <MarkdownInlineRun nodes={line} />
    </Fragment>
  ));
}

function MarkdownHeading(props: {
  readonly level: number;
  readonly inline: readonly MarkdownInline[];
}): ReactNode {
  const body = <MarkdownInlineRun nodes={props.inline} />;
  switch (Math.min(Math.max(props.level, 1), 6)) {
    case 1:
      return <h1>{body}</h1>;
    case 2:
      return <h2>{body}</h2>;
    case 3:
      return <h3>{body}</h3>;
    case 4:
      return <h4>{body}</h4>;
    case 5:
      return <h5>{body}</h5>;
    default:
      return <h6>{body}</h6>;
  }
}

function MarkdownBlockView(props: {
  readonly block: MarkdownBlock;
}): ReactNode {
  const block = props.block;
  switch (block.kind) {
    case "Heading":
      return <MarkdownHeading level={block.level} inline={block.inline} />;
    case "Paragraph":
      return (
        <p>
          <MarkdownLineRun lines={block.lines} />
        </p>
      );
    case "Quote":
      return (
        <blockquote>
          <MarkdownLineRun lines={block.lines} />
        </blockquote>
      );
    case "BulletList":
      return (
        <ul>
          {block.items.map((item, at) => (
            <li key={at}>
              <MarkdownInlineRun nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "OrderedList":
      return (
        <ol>
          {block.items.map((item, at) => (
            <li key={at}>
              <MarkdownInlineRun nodes={item} />
            </li>
          ))}
        </ol>
      );
    case "CodeBlock":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
  }
}

/** The worker's report, laid out as the markdown it tends to write. */
export function MarkdownReport(props: { readonly text: string }): ReactNode {
  const blocks = markdownReportBlocks(props.text);
  return (
    <div className="run-report">
      {blocks.map((block, at) => (
        <MarkdownBlockView key={at} block={block} />
      ))}
    </div>
  );
}
