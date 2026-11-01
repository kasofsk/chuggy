/**
 * A failed read's line as a reader reads it. Its word is a hover target of its
 * own, so the line is the notice around the word rather than one text node,
 * and a suite reads it whole here rather than matching a node it was split
 * into.
 */

import { screen } from "@testing-library/react";

/** Every failed read's line drawn under `within`, in document order. */
export function readFailedLines(
  within: ParentNode = document,
): readonly string[] {
  return [...within.querySelectorAll(".read-failed .notice")].map(
    (line) => line.textContent,
  );
}

/** The line a failed read is drawn as once it is drawn with `word`. */
export async function findReadFailedLine(word: string): Promise<string> {
  const drawn = await screen.findByText(word);
  const line = drawn.closest(".read-failed .notice");
  if (line === null) throw new Error(`${word} is not a failed read's word`);
  return line.textContent;
}
