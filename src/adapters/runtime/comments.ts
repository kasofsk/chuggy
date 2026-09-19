import { basename, extname } from "node:path";
import { createRequire } from "node:module";
import {
  Parser,
  Language,
  type Node as SyntaxNode,
  type Tree,
} from "web-tree-sitter";
import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";
const require = createRequire(import.meta.url);
export const PARSERS: Readonly<Record<string, string>> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".hcl": "hcl",
  ".tf": "hcl",
};
export const LANGUAGES: Readonly<Record<string, string>> = {
  ...PARSERS,
  ".scss": "scss",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
};
const DIRECTIVES =
  /^\s*(?:#!|(?:-\*-\s*)?coding\s*[:=]|(?:noqa|nosec|nosonar)\b|(?:fmt)\s*:|(?:eslint|oxlint|tslint|istanbul|c8|v8|prettier|stylelint|shellcheck|shfmt)\b|@(?:ts-|jsx|vite-|cc_on|preserve|license)|[#@]?\s*sourceMappingURL=|[#@]?\s*sourceURL=|[#@]__PURE__|#__NO_SIDE_EFFECTS__|@(?:type|typedef|param|returns?|template|implements|extends)\s*\{|(?:go:|\+build\b|s?cgo\b)|(?:pragma|clang-format|clang-tidy|NOLINT)\b|(?:frozen_string_literal|warn_indent|shareable_constant_value)\s*:|(?:syntax|escape)\s*=|\[if\b|<!\[endif|<reference\b|\+)/im;
const LICENSE =
  /\b(?:SPDX-License-Identifier|copy(?:right)|licensed under|license notice)\b/i;
export class CommentSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly replacement: string;
  readonly directive: boolean;
  readonly documentation: boolean;
  readonly syntax: string;
  constructor(
    start: number,
    end: number,
    text: string,
    replacement = "",
    directive = false,
    documentation = false,
    syntax = "",
  ) {
    this.start = start;
    this.end = end;
    this.text = text;
    this.replacement = replacement;
    this.directive = directive;
    this.documentation = documentation;
    this.syntax = syntax;
  }
}
export class Removal {
  readonly source: string;
  readonly removed: number;
  readonly preserved: number;
  constructor(source: string, removed: number, preserved: number) {
    this.source = source;
    this.removed = removed;
    this.preserved = preserved;
  }
}
export function supported(path: string): boolean {
  const suffix = extname(path),
    name = basename(path);
  return (
    suffix === ".qnt" ||
    Object.hasOwn(LANGUAGES, suffix) ||
    name.startsWith("Dockerfile") ||
    [".gitignore", ".dockerignore"].includes(name)
  );
}
function directive(text: string, syntax: string): boolean {
  const body = text.replace(/^\s*(?:\/\/+|\/\*+|<!--|--|#(?!!)|\*)\s?/gm, "");
  return (
    DIRECTIVES.test(body) ||
    LICENSE.test(text) ||
    /^<!--\s*[#@]/.test(text) ||
    (syntax === ".rb" && /^\s*encoding\s*:/.test(body)) ||
    (syntax === ".sql" && /^\s*Version\s+\d+\s*:/.test(body))
  );
}
let initialized: Promise<void> | null = null;
const languages = new Map<string, Promise<Language>>();
async function parse(
  language: string,
  source: string,
  path: string,
): Promise<Tree> {
  initialized ??= Parser.init();
  await initialized;
  let loaded = languages.get(language);
  if (!loaded) {
    loaded = Language.load(
      require.resolve(
        `@cursorless/tree-sitter-wasms/out/tree-sitter-${language}.wasm`,
      ),
    );
    languages.set(language, loaded);
  }
  const parser = new Parser();
  parser.setLanguage(await loaded);
  try {
    const tree = parser.parse(source);
    if (!tree) throw new Error(`comment hook cannot parse ${path}`);
    if (tree.rootNode.hasError) {
      tree.delete();
      throw new SyntaxError(`comment hook cannot parse ${path}`);
    }
    return tree;
  } finally {
    parser.delete();
  }
}
function embedded(node: SyntaxNode): string | null {
  if (node.parent?.type === "style_element") return ".css";
  if (node.parent?.type !== "script_element") return null;
  const start = node.parent.namedChildren[0];
  for (const attribute of start?.namedChildren ?? []) {
    if (attribute.type !== "attribute") continue;
    const [name, value] = attribute.namedChildren;
    if (
      name?.text.toLowerCase() === "type" &&
      value &&
      !["", "module", "text/javascript", "application/javascript"].includes(
        value.text.replace(/^['"]|['"]$/g, "").toLowerCase(),
      )
    )
      return null;
  }
  return ".js";
}
/** The grammar a suffix names, refusing a file no grammar covers. */
function grammar_for(
  table: Readonly<Record<string, string>>,
  suffix: string,
  path: string,
): string {
  const grammar = table[suffix];
  if (grammar === undefined)
    throw new Error(`comment hook has no grammar for ${path}`);
  return grammar;
}
function walk(node: SyntaxNode): SyntaxNode[] {
  return [node, ...node.children.flatMap(walk)];
}
async function syntax_spans(
  path: string,
  source: string,
): Promise<CommentSpan[]> {
  const suffix = extname(path),
    tree = await parse(grammar_for(PARSERS, suffix, path), source, path),
    spans: CommentSpan[] = [];
  try {
    const pending = [tree.rootNode];
    while (pending.length) {
      const node = pending.pop();
      if (node === undefined) break;
      if (["comment", "hash_bang_line"].includes(node.type))
        spans.push(
          new CommentSpan(
            node.startIndex,
            node.endIndex,
            node.text,
            "",
            false,
            false,
            suffix,
          ),
        );
      else if (node.type === "raw_text") {
        const nested = embedded(node);
        if (nested)
          for (const span of await syntax_spans("embedded" + nested, node.text))
            spans.push(
              new CommentSpan(
                node.startIndex + span.start,
                node.startIndex + span.end,
                span.text,
                "",
                false,
                false,
                span.syntax,
              ),
            );
      } else pending.push(...node.children.toReversed());
    }
    return spans;
  } finally {
    tree.delete();
  }
}
function token_text(
  token: string | Prism.Token | Array<string | Prism.Token>,
): string {
  if (typeof token === "string") return token;
  if (Array.isArray(token)) return token.map(token_text).join("");
  return token_text(token.content);
}
function lex_spans(path: string, source: string): CommentSpan[] {
  const suffix = extname(path),
    language = basename(path).startsWith("Dockerfile")
      ? "docker"
      : grammar_for(LANGUAGES, suffix, path);
  loadLanguages([language]);
  const grammar = Prism.languages[language];
  if (!grammar)
    throw new Error(
      `comment hook cannot lex ${path}: unavailable lexer ${language}`,
    );
  const spans: CommentSpan[] = [];
  let offset = 0;
  for (const token of Prism.tokenize(source, grammar)) {
    const value = token_text(token);
    if (
      typeof token !== "string" &&
      ["comment", "prolog", "doctype", "preprocessor", "macro"].includes(
        token.type,
      )
    ) {
      const cgo =
        suffix === ".go" &&
        (/^\/\/\s*export\s+\w+/.test(value) ||
          /^\s*(?:(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*)*import\s*"C"/.test(
            source.slice(offset + value.length),
          ));
      spans.push(
        new CommentSpan(
          offset,
          offset + value.length,
          value,
          "",
          ["preprocessor", "macro", "doctype"].includes(token.type) || cgo,
        ),
      );
    }
    offset += value.length;
  }
  return spans;
}
async function spans(path: string, source: string): Promise<CommentSpan[]> {
  const suffix = extname(path);
  if (suffix === ".qnt")
    return [
      ...source.matchAll(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g),
    ]
      .filter((m) => m[0].startsWith("/"))
      .map((m) => new CommentSpan(m.index, m.index + m[0].length, m[0]));
  if ([".gitignore", ".dockerignore"].includes(basename(path)))
    return [...source.matchAll(/^#[^\r\n]*/gm)].map(
      (m) => new CommentSpan(m.index, m.index + m[0].length, m[0]),
    );
  if (PARSERS[suffix]) return syntax_spans(path, source);
  return lex_spans(path, source);
}
function shape(node: SyntaxNode): unknown {
  if (["comment", "hash_bang_line"].includes(node.type)) return null;
  if (!node.children.length)
    return ["module", "block"].includes(node.type)
      ? [node.type, []]
      : [node.type, node.text];
  return [node.type, node.children.map(shape).filter((n) => n !== null)];
}
async function syntax_shape(path: string, source: string): Promise<string> {
  const suffix = extname(path),
    tree = await parse(grammar_for(PARSERS, suffix, path), source, path);
  try {
    if (suffix === ".html" || suffix === ".htm") {
      const nested: unknown[] = [];
      for (const node of walk(tree.rootNode)) {
        if (node.type === "raw_text") {
          const syntax = embedded(node);
          if (syntax)
            nested.push(await syntax_shape("embedded" + syntax, node.text));
        }
      }
      return JSON.stringify(nested);
    }
    return JSON.stringify(shape(tree.rootNode));
  } finally {
    tree.delete();
  }
}
/** Where one removed span reaches and what stands in its place. */
function span_edit(
  span: CommentSpan,
  source: string,
  path: string,
): [number, number, string] {
  let { start, end } = span,
    replacement = span.replacement;
  if ([".html", ".htm", ".css", ".scss"].includes(span.syntax || extname(path)))
    replacement = span.text.startsWith("//")
      ? span.text.replace(/[^\r\n]/g, "")
      : "";
  else if (!replacement) {
    const line_start = source.lastIndexOf("\n", start - 1) + 1;
    let line_end = source.indexOf("\n", end);
    if (line_end < 0) line_end = source.length;
    if (
      !source.slice(line_start, start).trim() &&
      !source.slice(end, line_end).trim()
    ) {
      start = line_start;
      end = Math.min(line_end + 1, source.length);
    } else if (span.documentation) replacement = "";
    else if (
      !source.slice(end, line_end).trim() &&
      !source.slice(start, end).includes("\n")
    ) {
      while (start > line_start && /[ \t]/.test(source[start - 1] ?? ""))
        start--;
      end = line_end;
    } else replacement = source.slice(start, end).replace(/[^\r\n]/g, " ");
  }
  return [start, end, replacement];
}
export async function remove_comments(
  path: string,
  source: string,
  previous = "",
  directives: readonly string[] = [],
): Promise<Removal> {
  const extra = directives.map((pattern) => new RegExp(pattern)),
    old = new Map<string, number>();
  for (const span of await spans(path, previous))
    old.set(span.text, (old.get(span.text) ?? 0) + 1);
  const edits: [number, number, string][] = [];
  let preserved = 0;
  for (const span of await spans(path, source)) {
    const count = old.get(span.text) ?? 0;
    if (count) {
      old.set(span.text, count - 1);
      continue;
    }
    if (
      span.directive ||
      (!span.documentation &&
        directive(span.text, span.syntax || extname(path))) ||
      extra.some((pattern) => pattern.test(span.text))
    ) {
      preserved++;
      continue;
    }
    const edit = span_edit(span, source, path);
    edits.push(edit);
  }
  let result = source;
  for (const [start, end, replacement] of edits.toReversed())
    result = result.slice(0, start) + replacement + result.slice(end);
  const suffix = extname(path);
  if (PARSERS[suffix]) {
    if (
      (await syntax_shape(path, source)) !== (await syntax_shape(path, result))
    )
      throw new Error(
        `comment removal changes syntax in ${path}; declare a processor exception`,
      );
  }
  return new Removal(result, edits.length, preserved);
}
