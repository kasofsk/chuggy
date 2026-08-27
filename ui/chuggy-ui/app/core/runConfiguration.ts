/**
 * The effective configuration one run was given, as the pane reads it: the
 * runtime's own init event, the resolved command line, and the instruction,
 * settings and plugin files it named.
 *
 * The snapshot is bytes a worker wrote, so it is parsed leniently: the init
 * event is opaque to the schema and read field by field, because a runtime that
 * says something new about itself must cost that field and not the document. Everything the worker left out — a file too large to keep, a
 * command line that did not fit — is listed as itself, because what was
 * omitted is part of what the run was configured with.
 */

import { z } from "zod";

import { runCountLabel } from "./runTotals.ts";

/**
 * The most files one snapshot names, above the count the worker's own walk
 * stops at, so a snapshot it wrote always reads.
 */
export const runConfigurationFilesMax = 512;

/** The most arguments one recorded command line carries. */
export const runConfigurationArgvMax = 1_024;

/** The sources the walk gathers from, in the order it gathers them. */
export const runConfigurationSources = [
  "MemoryPath",
  "ProjectInstruction",
  "Settings",
  "Plugin",
  "Provisioned",
] as const;
export type RunConfigurationSource = (typeof runConfigurationSources)[number];

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
export type RunConfigurationFile = z.infer<typeof snapshotFileSchema>;

export const runConfigurationSnapshotSchema = z.object({
  argv: z.array(z.string()).max(runConfigurationArgvMax),
  argvTruncated: truncationMarkerSchema.optional(),
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

/** What the runtime said it was when it started, and what it was given to run with. */
export interface RunConfigurationHead {
  readonly claudeVersion: string | undefined;
  readonly model: string | undefined;
  readonly permissionMode: string | undefined;
  readonly cwd: string | undefined;
  readonly tools: number | undefined;
  readonly skills: number | undefined;
  readonly initElidedBytes: number | undefined;
}

function initRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function initText(
  init: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = init[key];
  return typeof value === "string" ? value : undefined;
}

function initCount(
  init: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = init[key];
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * Each field is read on its own, so a runtime that says something new about
 * itself in one of them costs that field and not the whole event.
 */
export function runConfigurationHead(
  snapshot: RunConfigurationSnapshot,
): RunConfigurationHead {
  const elided = truncationMarkerOf(snapshot.init);
  const init = elided === undefined ? initRecord(snapshot.init) : {};
  return {
    claudeVersion: snapshot.claudeVersion,
    model: initText(init, "model"),
    permissionMode: initText(init, "permissionMode"),
    cwd: initText(init, "cwd"),
    tools: initCount(init, "tools"),
    skills: initCount(init, "skills"),
    initElidedBytes: elided?.bytes,
  };
}

function counted(value: number, noun: string): string {
  return `${runCountLabel(value)} ${noun}${value === 1 ? "" : "s"}`;
}

/** What the runtime reported it could reach, or that it reported none of it. */
export function runConfigurationCapabilitiesSentence(
  head: RunConfigurationHead,
): string {
  const said = [
    head.tools === undefined ? undefined : counted(head.tools, "tool"),
    head.skills === undefined ? undefined : counted(head.skills, "skill"),
  ].filter((part) => part !== undefined);
  return said.length === 0 ? "none were reported" : said.join(", ");
}

function runConfigurationSourceOrder(source: string): number {
  const at = runConfigurationSources.indexOf(source as RunConfigurationSource);
  return at === -1 ? runConfigurationSources.length : at;
}

/** Gathered order, which is the priority the walk used, with any source this
 * console does not know last. */
export function runConfigurationOrdered(
  files: readonly RunConfigurationFile[],
): readonly RunConfigurationFile[] {
  return [...files].sort(
    (left, right) =>
      runConfigurationSourceOrder(left.source) -
      runConfigurationSourceOrder(right.source),
  );
}

/** Where a file came to be part of this run's configuration. */
export function runConfigurationSourceSentence(source: string): string {
  switch (source) {
    case "MemoryPath":
      return "memory the runtime resolved";
    case "ProjectInstruction":
      return "an instruction file under the working directory";
    case "Settings":
      return "settings the runtime read";
    case "Plugin":
      return "a plugin the runtime loaded";
    case "Provisioned":
      return "a file the platform provisioned";
    default:
      return `a source this console does not know (${source})`;
  }
}

/** Why a listed file is drawn without all of its bytes, where it is. */
export function runConfigurationFileSentence(
  file: RunConfigurationFile,
): string | undefined {
  if (file.content === undefined)
    return file.digest === undefined
      ? "too large to read, so only its size was recorded"
      : "kept by digest and size rather than by content";
  return file.truncated === true
    ? "only the head of this file is kept; its digest and size are of the whole"
    : undefined;
}

/**
 * How many files the walk reached but the snapshot had no room even to name,
 * which is the difference between a short file list and a complete one.
 */
export function runConfigurationOmittedSentence(
  snapshot: RunConfigurationSnapshot,
): string | undefined {
  const omitted = snapshot.droppedOmitted ?? 0;
  if (omitted === 0) return undefined;
  return omitted === 1
    ? "1 further file was not named"
    : `${runCountLabel(omitted)} further files were not named`;
}

/** What the command line was, when it did not fit the snapshot whole. */
export function runConfigurationArgvSentence(
  snapshot: RunConfigurationSnapshot,
): string | undefined {
  const elided = truncationMarkerOf(snapshot.argvTruncated);
  return elided === undefined
    ? undefined
    : "the command line did not fit and is kept as a digest of itself";
}
