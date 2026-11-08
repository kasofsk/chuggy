/**
 * What a run was handed before its first call, from its configuration
 * snapshot: its brief, the instruction and settings files the runtime read,
 * and the tools, servers, skills, subagents and plugins its init event named,
 * each weighed by the newest reading where one weighs it.
 *
 * THE INIT EVENT IS THE RUNTIME'S AND IS READ LENIENTLY: a list it does not
 * carry is absent rather than empty, so a runtime that names no skills is not
 * drawn as one that had none.
 */

import { z } from "zod";

import type { RunContextWindow } from "../../../../src/contract/responses.ts";
import type { RunConfigurationSnapshot } from "./runConfiguration.ts";
import { runPromptOf } from "./runConfiguration.ts";

/** The most names one list of the init event is read for. */
export const contextInputsNamesMax = 512;

const contextNamedSchema = z.union([
  z.string(),
  z.object({ name: z.string() }).transform((named) => named.name),
]);

const contextNamesSchema = z
  .array(z.unknown())
  .max(contextInputsNamesMax)
  .transform((items) =>
    items.flatMap((item) => {
      const named = contextNamedSchema.safeParse(item);
      return named.success && named.data.length > 0 ? [named.data] : [];
    }),
  );

const contextInitSchema = z.object({
  cwd: z.string().optional().catch(undefined),
  tools: contextNamesSchema.optional().catch(undefined),
  mcp_servers: contextNamesSchema.optional().catch(undefined),
  skills: contextNamesSchema.optional().catch(undefined),
  agents: contextNamesSchema.optional().catch(undefined),
  plugins: contextNamesSchema.optional().catch(undefined),
});

/** Where a file sits in the Inputs table. */
export type ContextFileGroup = "Instructions" | "Settings" | "Other";

/** One file the runtime read, as the Inputs table lists it. */
export interface ContextFile {
  readonly group: ContextFileGroup;
  /** As a reader names it: under the working directory where it is there. */
  readonly path: string;
  readonly bytes: number;
  readonly tokens: number | undefined;
  readonly content: string | undefined;
}

/** A list the init event named, with what the newest reading weighed it at. */
export interface ContextNames {
  readonly names: readonly string[];
  readonly tokens: number | undefined;
  readonly deferred: number | undefined;
}

export interface ContextInputs {
  readonly brief: string | undefined;
  readonly files: readonly ContextFile[];
  readonly tools: ContextNames | undefined;
  readonly mcpServers: ContextNames | undefined;
  readonly skills: ContextNames | undefined;
  readonly agents: ContextNames | undefined;
  readonly plugins: ContextNames | undefined;
}

/** The snapshot's brief: its own field where the worker wrote one, or the
 * prompt its command line ends on. */
export function contextBriefOf(
  snapshot: RunConfigurationSnapshot,
): string | undefined {
  if (snapshot.brief !== undefined && snapshot.brief.length > 0)
    return snapshot.brief;
  const prompt = runPromptOf(snapshot);
  return prompt.prompt === "Kept" ? prompt.text : undefined;
}

const contextSettingsFlag = "--settings";

const contextSettingsSchema = z.object({
  autoCompactWindow: z.number().int().positive(),
});

function contextSettingsWindow(value: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const settings = contextSettingsSchema.safeParse(parsed);
  return settings.success ? settings.data.autoCompactWindow : undefined;
}

/** The window the command line's `--settings` names, whether as one word or
 * as the word after the flag; a settings file it names is not read. */
export function contextSettingsWindowOf(
  argv: readonly string[],
): number | undefined {
  let named: number | undefined = undefined;
  argv.forEach((word, index) => {
    const value = word.startsWith(`${contextSettingsFlag}=`)
      ? word.slice(contextSettingsFlag.length + 1)
      : word === contextSettingsFlag
        ? argv[index + 1]
        : undefined;
    const window =
      value === undefined ? undefined : contextSettingsWindow(value);
    if (window !== undefined) named = window;
  });
  return named;
}

function contextFileGroup(source: string): ContextFileGroup {
  if (source === "MemoryPath" || source === "ProjectInstruction")
    return "Instructions";
  return source === "Settings" ? "Settings" : "Other";
}

function contextFilePath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0) return path;
  const under = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(under) ? path.slice(under.length) : path;
}

/** A path as the pieces a line may break between, each up to and with its
 * slash, so a long path wraps between names and never inside one. */
export function contextPathParts(path: string): readonly string[] {
  return path.split(/(?<=\/)/u);
}

const contextFileGroupOrder: readonly ContextFileGroup[] = [
  "Instructions",
  "Settings",
  "Other",
];

/** The files the snapshot carried, by group in the order the runtime read
 * them, each weighed where the reading names its path. */
export function contextFilesOf(
  snapshot: RunConfigurationSnapshot,
  window: RunContextWindow | undefined,
  cwd: string | undefined,
): readonly ContextFile[] {
  const weighed = new Map(
    (window?.memoryFiles ?? []).map((file) => [file.path, file.tokens]),
  );
  const files = snapshot.files.map((file): ContextFile => ({
    group: contextFileGroup(file.source),
    path: contextFilePath(file.path, cwd),
    bytes: file.bytes,
    tokens: weighed.get(file.path),
    content: file.content,
  }));
  return contextFileGroupOrder.flatMap((group) =>
    files.filter((file) => file.group === group),
  );
}

function contextCategoryTokens(
  window: RunContextWindow | undefined,
  said: string,
): number | undefined {
  return window?.categories.find(
    (category) => category.name.trim().toLowerCase() === said,
  )?.tokens;
}

function contextNamesOf(
  names: readonly string[] | undefined,
  tokens: number | undefined,
  deferred?: number,
): ContextNames | undefined {
  return names === undefined ? undefined : { names, tokens, deferred };
}

/** Everything the Inputs section draws of one run. */
export function contextInputsOf(
  snapshot: RunConfigurationSnapshot,
  window: RunContextWindow | undefined,
): ContextInputs {
  const read = contextInitSchema.safeParse(snapshot.init);
  const init = read.success ? read.data : undefined;
  return {
    brief: contextBriefOf(snapshot),
    files: contextFilesOf(snapshot, window, init?.cwd),
    tools: contextNamesOf(
      init?.tools,
      contextCategoryTokens(window, "system tools"),
      window?.categories
        .filter((category) => category.kind === "Deferred")
        .reduce((sum, category) => sum + category.tokens, 0) || undefined,
    ),
    mcpServers: contextNamesOf(
      init?.mcp_servers,
      contextCategoryTokens(window, "mcp tools"),
    ),
    skills: contextNamesOf(init?.skills, window?.skills?.tokens),
    agents: contextNamesOf(
      init?.agents,
      contextCategoryTokens(window, "custom agents"),
    ),
    plugins: contextNamesOf(init?.plugins, undefined),
  };
}
