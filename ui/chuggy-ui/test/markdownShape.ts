/**
 * What a reading of a text comes to, in the forms the report's suites assert
 * on: the whole of it as one line a failure can be read from, the blocks it is
 * made of and how they nest, and every character a reader is drawn with the
 * marks it is drawn in.
 */

import type {
  MarkdownBlock,
  MarkdownNode,
} from "../app/browser/ui/markdownTree.ts";

function attributes(node: MarkdownNode): string {
  if (node.type === "heading") return String(node.depth);
  if (node.type === "list")
    return node.ordered === true ? ` ordered from ${String(node.start)}` : "";
  if (node.type === "listItem") {
    if (typeof node.checked !== "boolean") return "";
    return node.checked ? " ticked" : " unticked";
  }
  if (node.type === "code")
    return typeof node.lang === "string" ? ` ${node.lang}` : "";
  if (node.type === "table")
    return ` ${(node.align ?? []).map((side) => side ?? "none").join(",")}`;
  return node.type === "link" ? ` ${node.url}` : "";
}

function shapeOf(node: MarkdownNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "break") return "<break>";
  if (node.type === "thematicBreak") return "<rule>";
  const held =
    "children" in node
      ? node.children.map(shapeOf).join("")
      : "value" in node
        ? node.value
        : "";
  return `<${node.type}${attributes(node)}>${held}</${node.type}>`;
}

/** A reading as one line: every node by its name, holding what it holds. */
export function shape(blocks: readonly MarkdownBlock[]): string {
  return blocks.map(shapeOf).join("");
}

const inlineMarks = ["strong", "emphasis", "delete", "inlineCode"];

function skeletonOf(node: MarkdownNode, depth: number, into: string[]): void {
  if (node.type === "text" || node.type === "break") return;
  if (inlineMarks.includes(node.type) || node.type === "link") return;
  into.push(`${String(depth)} ${node.type}`);
  if ("children" in node)
    for (const child of node.children) skeletonOf(child, depth + 1, into);
}

/** The blocks of a reading in the order they are drawn, each with how deep it
 * sits, which is what must only ever be added to while a text is written. */
export function skeleton(blocks: readonly MarkdownBlock[]): readonly string[] {
  const into: string[] = [];
  for (const block of blocks) skeletonOf(block, 0, into);
  return into;
}

/** Every character drawn, and beside each the marks it is drawn in. */
export interface Drawn {
  readonly characters: string;
  readonly marks: string;
}

function drawnOf(node: MarkdownNode, marks: number, into: string[][]): void {
  const [characters, marked] = into;
  if (characters === undefined || marked === undefined) return;
  const at = inlineMarks.indexOf(node.type);
  const within = at === -1 ? marks : marks | (1 << at);
  if (node.type === "break") {
    characters.push("\n");
    marked.push(String.fromCharCode(65 + within));
  } else if ("value" in node) {
    characters.push(node.value);
    marked.push(String.fromCharCode(65 + within).repeat(node.value.length));
  } else if ("children" in node)
    for (const child of node.children) drawnOf(child, within, into);
}

/** What a reader is drawn of a reading, character by character. */
export function drawn(blocks: readonly MarkdownBlock[]): Drawn {
  const into: string[][] = [[], []];
  for (const block of blocks) drawnOf(block, 0, into);
  return {
    characters: (into[0] ?? []).join(""),
    marks: (into[1] ?? []).join(""),
  };
}

/** Whether every character of one text is in another, in order: nothing a
 * reader was drawn has been taken away, whatever has been added between. */
export function within(before: string, after: string): boolean {
  let at = 0;
  for (let index = 0; index < after.length && at < before.length; index += 1)
    if (before.charCodeAt(at) === after.charCodeAt(index)) at += 1;
  return at === before.length;
}

/** Every prefix of a text, shortest first, the text itself last. */
export function prefixes(text: string, stride = 1): readonly string[] {
  const lengths: number[] = [];
  for (let length = 0; length < text.length; length += stride)
    lengths.push(length);
  return [...lengths, text.length].map((length) => text.slice(0, length));
}
