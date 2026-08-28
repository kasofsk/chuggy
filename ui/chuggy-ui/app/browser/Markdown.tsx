/**
 * The markdown an agent wrote, drawn as the elements it names rather than the
 * characters it was typed as.
 *
 * Every span this pane draws came from `markdownBlocksOf`, which already
 * refused a link whose scheme was not one an address bar would follow; what
 * is left still opens in its own tab and carries no referrer, because the
 * page it names is not this one.
 */

import { Fragment } from "react";
import type { ReactNode } from "react";

import { markdownBlocksOf } from "../core/markdown.ts";
import type { MarkdownBlock, MarkdownInline } from "../core/markdown.ts";

function MarkdownInlineView(props: {
  readonly inline: readonly MarkdownInline[];
}): ReactNode {
  return (
    <>
      {props.inline.map((node, index) => {
        switch (node.kind) {
          case "Text":
            return <Fragment key={index}>{node.text}</Fragment>;
          case "Code":
            return <code key={index}>{node.text}</code>;
          case "Strong":
            return <strong key={index}>{node.text}</strong>;
          case "Emphasis":
            return <em key={index}>{node.text}</em>;
          case "Link":
            return (
              <a
                key={index}
                href={node.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {node.text}
              </a>
            );
        }
      })}
    </>
  );
}

function MarkdownHeadingView(props: {
  readonly level: number;
  readonly children: ReactNode;
}): ReactNode {
  switch (props.level) {
    case 1:
      return <h1 className="markdown-heading">{props.children}</h1>;
    case 2:
      return <h2 className="markdown-heading">{props.children}</h2>;
    case 3:
      return <h3 className="markdown-heading">{props.children}</h3>;
    case 4:
      return <h4 className="markdown-heading">{props.children}</h4>;
    case 5:
      return <h5 className="markdown-heading">{props.children}</h5>;
    default:
      return <h6 className="markdown-heading">{props.children}</h6>;
  }
}

function MarkdownBlockView(props: {
  readonly block: MarkdownBlock;
}): ReactNode {
  const block = props.block;
  switch (block.kind) {
    case "Heading":
      return (
        <MarkdownHeadingView level={block.level}>
          <MarkdownInlineView inline={block.inline} />
        </MarkdownHeadingView>
      );
    case "Paragraph":
      return (
        <p className="markdown-paragraph">
          <MarkdownInlineView inline={block.inline} />
        </p>
      );
    case "CodeBlock":
      return (
        <pre className="markdown-code">
          <code>{block.text}</code>
        </pre>
      );
    case "List": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <MarkdownInlineView inline={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="markdown-list">{items}</ol>
      ) : (
        <ul className="markdown-list">{items}</ul>
      );
    }
  }
}

/** One piece of agent-written markdown, drawn block by block. */
export function Markdown(props: { readonly text: string }): ReactNode {
  return (
    <div className="markdown">
      {markdownBlocksOf(props.text).map((block, index) => (
        <MarkdownBlockView key={index} block={block} />
      ))}
    </div>
  );
}
