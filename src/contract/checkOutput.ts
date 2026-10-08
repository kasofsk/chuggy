/**
 * What a command stage's worker writes of the commands it ran: the output it is
 * served as, and the document's shape.
 *
 * The document is `{"checks": [...]}`, one entry per command that ran, in the
 * order it ran. An entry is what the command wrote, standard output and
 * standard error interleaved, and how it ended: an exit status, or a signal
 * where there is none. The stage stops at the first command that does not exit
 * zero, so a failing entry is always the last. Where `truncated` is true the
 * worker kept the head of the output and the result's report carries the end.
 *
 * The worker core writes it in kasofsk/chuggy-common, and nothing in the worker
 * contract's package names it: it is a document the console reads, not one the
 * plane accepts.
 */

import { z } from "zod";

export const checkOutputName = "check-output";

export const checkOutputPath = ".chuggy/check-output.json";

const checkOutputExitedSchema = z.strictObject({
  command: z.string(),
  exitStatus: z.number().int(),
  truncated: z.boolean(),
  output: z.string(),
});

const checkOutputSignalledSchema = z.strictObject({
  command: z.string(),
  exitStatus: z.null(),
  signal: z.string().min(1),
  truncated: z.boolean(),
  output: z.string(),
});

export const checkOutputSchema = z.strictObject({
  checks: z.array(
    z.union([checkOutputExitedSchema, checkOutputSignalledSchema]),
  ),
});
export type CheckOutput = z.infer<typeof checkOutputSchema>;
export type CheckOutputEntry = CheckOutput["checks"][number];
