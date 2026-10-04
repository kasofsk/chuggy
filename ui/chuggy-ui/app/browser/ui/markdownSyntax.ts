/**
 * The colouring of a block of code: which languages are coloured, what a
 * coloured block is, and the grammars held apart from the page that draws it.
 *
 * THE GRAMMARS ARE FETCHED WHEN CODE IN ONE OF THEM IS FIRST DRAWN. They are a
 * chunk of their own, so a reader who is never shown code never fetches them,
 * and until they arrive a block is drawn as its characters. Colour is all that
 * arrives with them: a coloured run is the same characters in the same face,
 * so nothing drawn changes its place when it is coloured.
 *
 * A LANGUAGE IS COLOURED ONLY WHERE THE FENCE NAMES IT. Nothing guesses at
 * what an unnamed block is written in, because a wrong guess colours prose as
 * code, and a name outside the table below is drawn plain.
 *
 * WHAT IS COLOURED IS BOUNDED. A block is read again whole each time it grows,
 * so one longer than `markdownSyntaxCharsMax` is not coloured at all.
 */

import { useEffect, useSyncExternalStore } from "react";

import type { MarkdownSyntaxNode } from "./markdownSyntaxRead.ts";

export type { MarkdownSyntaxNode };

/** The longest block that is coloured, in characters. */
export const markdownSyntaxCharsMax = 20_000;

/** A block of code read into its runs, or nothing where it cannot be. */
export type MarkdownSyntaxRead = (
  code: string,
  language: string,
) => readonly MarkdownSyntaxNode[] | undefined;

/** The grammar each name a fence gives a language is read with. */
export const markdownSyntaxLanguages: Readonly<Record<string, string>> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",
  css: "css",
  diff: "diff",
  patch: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  go: "go",
  golang: "go",
  ini: "ini",
  toml: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  kotlin: "kotlin",
  kt: "kotlin",
  md: "markdown",
  markdown: "markdown",
  php: "php",
  py: "python",
  python: "python",
  python3: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  html: "xml",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/** The grammar a fence's word names, whatever case it was written in. */
export function markdownSyntaxLanguage(named: string): string | undefined {
  const name = named.toLowerCase();
  return Object.hasOwn(markdownSyntaxLanguages, name)
    ? markdownSyntaxLanguages[name]
    : undefined;
}

let held: MarkdownSyntaxRead | undefined = undefined;
let asked = false;
const waiting = new Set<() => void>();

/** Asks for the grammars, once: a fetch that fails is asked for again by the
 * next block that needs them. */
function markdownSyntaxAsked(): void {
  if (asked) return;
  asked = true;
  void import("./markdownSyntaxRead.ts").then(
    (grammars) => {
      held = grammars.markdownSyntaxRead;
      for (const told of waiting) told();
    },
    () => {
      asked = false;
    },
  );
}

function markdownSyntaxWaited(told: () => void): () => void {
  waiting.add(told);
  return () => {
    waiting.delete(told);
  };
}

/** The reader of code into its runs, once the grammars have arrived, asked for
 * when the block drawn is in a language that is coloured. */
export function useMarkdownSyntax(
  language: string | undefined,
): MarkdownSyntaxRead | undefined {
  const coloured = language !== undefined;
  useEffect(() => {
    if (coloured) markdownSyntaxAsked();
  }, [coloured]);
  return useSyncExternalStore(markdownSyntaxWaited, () => held);
}
