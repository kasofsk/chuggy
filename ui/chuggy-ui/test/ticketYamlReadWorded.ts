/**
 * A ticket's text read as the YAML screen reads it, each problem in the words
 * the screen draws, so a suite asserts the English a reader sees.
 */

import { ticketYamlRead } from "../app/browser/editor/ticketYaml.ts";
import type { TicketYamlReading } from "../app/browser/editor/ticketYaml.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyOrDataText } from "../app/core/copy.ts";

export function ticketYamlReadWorded(
  ...read: Parameters<typeof ticketYamlRead>
): TicketYamlReading {
  const reading = ticketYamlRead(...read);
  return {
    ...reading,
    problems: reading.problems.map((problem) => ({
      ...problem,
      message: copyOrDataText(copyTextEn, problem.message),
    })),
  };
}
