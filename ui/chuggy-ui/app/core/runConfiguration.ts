/**
 * The effective configuration one run was given, read for the prompt its
 * command line ends on.
 *
 * The snapshot is bytes a worker wrote, so it is parsed leniently: the init
 * event is opaque to the schema, because a runtime that says something new
 * about itself must not cost the document, and a command line that did not fit
 * keeps no prompt rather than a cut one.
 */

import { z } from "zod";

import type { RunConfigurationResponse } from "../../../../src/contract/responses.ts";
import type { PanelState } from "./freshness.ts";

/**
 * The most files one snapshot names, above the count the worker's own walk
 * stops at, so a snapshot it wrote always reads.
 */
export const runConfigurationFilesMax = 512;

/** The most arguments one recorded command line carries. */
export const runConfigurationArgvMax = 1_024;

const truncationMarkerSchema = z.object({
  chuggy_truncated: z.object({
    bytes: z.number().int().nonnegative(),
    digest: z.string().min(1),
  }),
});

const snapshotFileSchema = z.object({
  source: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  digest: z.string().min(1).optional(),
  content: z.string().optional(),
  truncated: z.boolean().optional(),
});

export const runConfigurationSnapshotSchema = z.object({
  argv: z.array(z.string()).max(runConfigurationArgvMax),
  argvTruncated: truncationMarkerSchema.optional(),
  agent: z.string().optional(),
  claudeVersion: z.string().optional(),
  init: z.unknown(),
  files: z.array(snapshotFileSchema).max(runConfigurationFilesMax),
  dropped: z.array(snapshotFileSchema).max(runConfigurationFilesMax),
  droppedOmitted: z.number().int().nonnegative().optional(),
});
export type RunConfigurationSnapshot = z.infer<
  typeof runConfigurationSnapshotSchema
>;

export type RunConfigurationReading =
  | {
      readonly reading: "Snapshot";
      readonly snapshot: RunConfigurationSnapshot;
    }
  | { readonly reading: "Unreadable"; readonly reason: string };

/** The stored bytes as the snapshot they are, or the reason they are not one. */
export function runConfigurationRead(content: string): RunConfigurationReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      reading: "Unreadable",
      reason: "the stored snapshot is not the JSON document a run writes",
    };
  }
  const read = runConfigurationSnapshotSchema.safeParse(parsed);
  return read.success
    ? { reading: "Snapshot", snapshot: read.data }
    : {
        reading: "Unreadable",
        reason: "the stored snapshot is not shaped as this console reads one",
      };
}

function truncationMarkerOf(
  value: unknown,
): { readonly bytes: number } | undefined {
  const marker = truncationMarkerSchema.safeParse(value);
  return marker.success ? marker.data.chuggy_truncated : undefined;
}

/** The prompt a run was handed, or that its snapshot does not hold one. */
export type RunPrompt =
  | { readonly prompt: "Kept"; readonly text: string }
  | { readonly prompt: "NotKept" }
  | { readonly prompt: "Unreadable" };

/** The agents whose worker hands the prompt as the command line's last word. A
 * snapshot from before the worker named its agent was Claude's, the only one
 * that wrote one then. */
function runPromptLast(snapshot: RunConfigurationSnapshot): boolean {
  if (snapshot.agent === undefined) return snapshot.claudeVersion !== undefined;
  return snapshot.agent === "Claude" || snapshot.agent === "Codex";
}

/** The prompt the snapshot's command line ends on, where it kept that line. */
export function runPromptOf(snapshot: RunConfigurationSnapshot): RunPrompt {
  const text = snapshot.argv.at(-1);
  if (
    truncationMarkerOf(snapshot.argvTruncated) !== undefined ||
    !runPromptLast(snapshot) ||
    text === undefined ||
    text.length === 0
  )
    return { prompt: "NotKept" };
  return { prompt: "Kept", text };
}

/** The stored snapshot's prompt, or that the bytes are not a snapshot at all. */
export function runPromptRead(content: string): RunPrompt {
  const reading = runConfigurationRead(content);
  return reading.reading === "Snapshot"
    ? runPromptOf(reading.snapshot)
    : { prompt: "Unreadable" };
}

/** The prompt as far as the snapshot's read has got: nothing while it is out,
 * and a read that failed is not a snapshot that kept none. */
export function runPromptOfPanel(
  state: PanelState<RunConfigurationResponse>,
): RunPrompt | undefined {
  switch (state.state) {
    case "Pending":
      return undefined;
    case "Ready":
      return runPromptRead(state.value.content);
    case "Absent":
      return { prompt: "NotKept" };
    case "Failed":
      return { prompt: "Unreadable" };
  }
}

/** The most lines a prompt shows before a reader asks for the rest. */
export const runPromptHeadLinesMax = 6;

/** The most characters those lines carry, since one line can be a paragraph. */
export const runPromptHeadCharsMax = 480;

/** The opening a prompt is drawn with while folded, and whether it is all of it. */
export function runPromptHead(text: string): {
  readonly head: string;
  readonly cut: boolean;
} {
  const lines = text.split("\n").slice(0, runPromptHeadLinesMax).join("\n");
  const head = lines.slice(0, runPromptHeadCharsMax);
  return head.length === text.length
    ? { head, cut: false }
    : { head: `${head.trimEnd()}…`, cut: true };
}
