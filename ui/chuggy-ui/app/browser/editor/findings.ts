/**
 * Where a finding belongs in the text the author is looking at.
 *
 * The server faults a document by JSON pointer, because that is what it
 * validated — a parsed value, which has fields but no lines. The line is the
 * author's coordinate, so it is recovered here, by walking the same YAML the
 * pointer addresses and taking the range the node was parsed from.
 *
 * A pointer that no longer resolves yields a finding without a line rather
 * than a wrong one: the text moved under the verdict, and an arrow at an
 * arbitrary line is worse than none.
 */
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import type { AdoptedTicketFinding } from "../../../../../src/contract/adoptedTickets.ts";
import type { EditorFinding } from "./chugEditor.ts";

/** `/work/0/prompt` addresses the same place `["work", 0, "prompt"]` does. */
export function pointerPath(pointer: string): readonly (string | number)[] {
  if (pointer === "" || pointer === "/") return [];
  return pointer
    .replace(/^\//u, "")
    .split("/")
    .map((part) => {
      const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
      return /^\d+$/u.test(decoded) ? Number(decoded) : decoded;
    });
}

/** The offset a path was parsed from, or undefined where it no longer resolves. */
function pathOffset(
  source: string,
  path: readonly (string | number)[],
): number | undefined {
  let node: unknown = parseDocument(source).contents;
  for (const step of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === String(step),
      );
      if (pair === undefined) return undefined;
      /** A missing value still faults at its key, which is where the author looks. */
      node = pair.value ?? pair.key;
    } else if (isSeq(node) && typeof step === "number") {
      const item: unknown = node.items[step];
      if (item === undefined) return undefined;
      node = item;
    } else return undefined;
  }
  const range = (node as { range?: readonly number[] } | null)?.range;
  return range === undefined ? undefined : range[0];
}

/** The 1-based line and column an offset falls on. */
function placeOf(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

export function editorFindings(
  findings: readonly AdoptedTicketFinding[],
  source: string,
): readonly EditorFinding[] {
  return findings.map((finding) => {
    const offset =
      finding.path === ""
        ? undefined
        : pathOffset(source, pointerPath(finding.path));
    const place = offset === undefined ? undefined : placeOf(source, offset);
    return {
      line: place?.line ?? null,
      column: place?.column ?? null,
      message:
        finding.path === ""
          ? finding.message
          : `${finding.path}: ${finding.message}`,
      severity: "error" as const,
    };
  });
}
