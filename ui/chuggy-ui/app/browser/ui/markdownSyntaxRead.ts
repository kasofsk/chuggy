/**
 * The grammars code is coloured with, and the reading of a block into runs.
 *
 * This module is what `markdownSyntaxWorker.ts` runs, and nothing the page
 * loads may import it for more than a type: every grammar here is bundled with
 * it, and a grammar is patterns that can take a time out of all proportion to
 * the text they are handed. A grammar is added by importing it here and naming
 * it in `markdownSyntax.ts`'s table. It takes nothing from the rest of the
 * console, so the worker shares no module with the page.
 *
 * The highlighter's own tree is read into `MarkdownSyntaxNode` here, so that
 * no mark of it reaches the page as markup: a run is characters, or a scope
 * naming the highlighter's own class and holding runs. A scope is an element
 * the page has to draw, so a block is handed back with no more of them than
 * `markdownSyntaxScopesMax`, however dense in them its text is.
 */

import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/** A run of code: its characters, or a scope holding runs. */
export type MarkdownSyntaxNode =
  | string
  | {
      readonly scope: string;
      readonly children: readonly MarkdownSyntaxNode[];
    };

/** How deep one coloured run may sit inside another; past it a scope is drawn
 * as its characters. */
export const markdownSyntaxDepthMax = 8;

/** How many scopes one block is coloured with; the code after them is drawn
 * as its characters. */
export const markdownSyntaxScopesMax = 16_384;

const markdownSyntaxGrammars = createLowlight({
  bash,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
});

type SyntaxTree = ReturnType<typeof markdownSyntaxGrammars.highlight>;
type SyntaxTreeNode = SyntaxTree["children"][number];

/** The class the highlighter's sheet names carry, which is all of a scope's
 * names this keeps. */
const markdownSyntaxScopePrefix = "hljs-";

/** Every character under a node, with no scope kept. */
function markdownSyntaxWords(node: SyntaxTreeNode): string {
  const pending: SyntaxTreeNode[] = [node];
  const words: string[] = [];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    if (next.type === "text") words.push(next.value);
    if (next.type === "element")
      for (let at = next.children.length - 1; at >= 0; at -= 1) {
        const child = next.children[at];
        if (child !== undefined) pending.push(child);
      }
  }
  return words.join("");
}

function markdownSyntaxScope(names: unknown): string {
  if (!Array.isArray(names)) return "";
  return names
    .filter(
      (name): name is string =>
        typeof name === "string" && name.startsWith(markdownSyntaxScopePrefix),
    )
    .join(" ");
}

/** The scopes one block may still be coloured with. */
interface MarkdownSyntaxLeft {
  scopes: number;
}

function markdownSyntaxNode(
  node: SyntaxTreeNode,
  depth: number,
  left: MarkdownSyntaxLeft,
): MarkdownSyntaxNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (depth >= markdownSyntaxDepthMax || left.scopes === 0)
    return markdownSyntaxWords(node);
  left.scopes -= 1;
  return {
    scope: markdownSyntaxScope(node.properties.className),
    children: markdownSyntaxNodes(node.children, depth + 1, left),
  };
}

/** Nodes as runs, with characters that stand together made one run. */
function markdownSyntaxNodes(
  nodes: readonly SyntaxTreeNode[],
  depth: number,
  left: MarkdownSyntaxLeft,
): readonly MarkdownSyntaxNode[] {
  const runs: MarkdownSyntaxNode[] = [];
  let words: string[] = [];
  for (const node of nodes) {
    const run = markdownSyntaxNode(node, depth, left);
    if (typeof run === "string") {
      words.push(run);
      continue;
    }
    if (words.length > 0) runs.push(words.join(""));
    words = [];
    runs.push(run);
  }
  if (words.length > 0) runs.push(words.join(""));
  return runs;
}

/** The grammars this chunk carries, by the name the table reads each with. */
export function markdownSyntaxGrammarNames(): readonly string[] {
  return markdownSyntaxGrammars.listLanguages();
}

/** A block of code as its runs, or nothing where no grammar here reads the
 * language or the grammar gave up on the text. */
export function markdownSyntaxRead(
  code: string,
  language: string,
): readonly MarkdownSyntaxNode[] | undefined {
  if (!markdownSyntaxGrammars.registered(language)) return undefined;
  try {
    const read = markdownSyntaxGrammars.highlight(language, code);
    return markdownSyntaxNodes(read.children, 0, {
      scopes: markdownSyntaxScopesMax,
    });
  } catch {
    return undefined;
  }
}

/** What the worker is asked: one block, and the number its answer carries. */
export interface MarkdownSyntaxAsked {
  readonly id: number;
  readonly code: string;
  readonly language: string;
}

/** What the worker answers: the block's runs, or nothing where it has none. */
export interface MarkdownSyntaxAnswer {
  readonly id: number;
  readonly runs: readonly MarkdownSyntaxNode[] | undefined;
}

/** The answer to one message, or nothing where the message asks nothing. */
export function markdownSyntaxAnswered(
  message: unknown,
): MarkdownSyntaxAnswer | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { id, code, language } = message as {
    readonly id?: unknown;
    readonly code?: unknown;
    readonly language?: unknown;
  };
  if (typeof id !== "number" || typeof code !== "string") return undefined;
  if (typeof language !== "string") return undefined;
  return { id, runs: markdownSyntaxRead(code, language) };
}
