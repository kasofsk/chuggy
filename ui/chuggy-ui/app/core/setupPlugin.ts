/**
 * The plugin step and `plugin`, the command that does it: chuggy's Claude Code
 * plugin, whose setup skill an agent follows for the rest of setup, installed
 * from its marketplace through Claude Code's own commands at their default
 * scope, the person's own.
 *
 * Every command that changes the plugin is run with `--json`, and of what it
 * prints only the last line is read, since a marketplace may print ahead of
 * it. The list is read whole. No settings file of Claude Code's is read or
 * written here, so a session that has reloaded its plugins looks no different
 * from one that has not: where the plugin is left on, the run asks the person
 * to reload and leaves the agent to tell from its own skills. Where it is not
 * left on, the run says why and names the checklist past the step, as the
 * person's no would, so nothing here holds setup up.
 */

import { z } from "zod";

import { setupPluginSkip } from "./setupArguments.ts";
import type { SetupAnswers, SetupAsked } from "./setupArguments.ts";
import type { SetupPorts } from "./setupPorts.ts";
import {
  setupPluginId,
  setupPluginMarketplace,
  setupPluginSource,
  setupPluginSparse,
} from "./setupProgram.ts";
import type {
  SetupPluginDid,
  SetupPluginEnded,
  SetupReport,
} from "./setupReport.ts";
import { setupActed } from "./setupRunner.ts";
import {
  setupChildBytesMax,
  setupPackageCurrent,
  setupProbeWaitMs,
} from "./setupRunnerMachine.ts";
import type { SetupRunnerAct } from "./setupRunnerSaid.ts";
import type { SetupPluginHere } from "./setupStanding.ts";
import { setupExcerpt } from "./setupText.ts";

/** The oldest Claude Code whose every command `plugin` runs takes `--json`. */
export const setupPluginClaudeLeast = "2.1.287";

export const setupPluginVersionCommand: readonly string[] = [
  "claude",
  "--version",
];

export const setupPluginListCommand: readonly string[] = [
  "claude",
  "plugin",
  "list",
  "--json",
];

/** Each command that changes the plugin or its marketplace, by the act it is. */
export const setupPluginCommands: Readonly<
  Record<Extract<SetupRunnerAct, `Plugin${string}`>, readonly string[]>
> = {
  PluginMarketplaceAdd: [
    "claude",
    "plugin",
    "marketplace",
    "add",
    setupPluginSource,
    "--json",
    "--sparse",
    ...setupPluginSparse,
  ],
  PluginInstall: ["claude", "plugin", "install", setupPluginId, "--json"],
  PluginMarketplaceUpdate: [
    "claude",
    "plugin",
    "marketplace",
    "update",
    setupPluginMarketplace,
    "--json",
  ],
  PluginUpdate: ["claude", "plugin", "update", setupPluginId, "--json"],
  PluginEnable: ["claude", "plugin", "enable", setupPluginId, "--json"],
};

const setupPluginEntrySchema = z.looseObject({
  id: z.string(),
  enabled: z.boolean(),
  installPath: z.string(),
  readFromFolder: z.string().optional(),
});

const setupPluginListSchema = z.array(z.unknown());

const setupPluginResultSchema = z.looseObject({
  outcome: z.string(),
  message: z.string().optional(),
});

/** The plugin as the list says it: not read, not installed, or installed, whether enabled, with the folder sessions read it from. */
export type SetupPluginListed =
  | { readonly listed: "Unread" | "None" }
  | {
      readonly listed: "Had";
      readonly enabled: boolean;
      readonly folder: string;
    };

function setupPluginJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads Claude Code's list of installed plugins, and changes nothing. An entry the list holds in a shape this program does not read is passed over, as another plugin's would be. */
export async function setupPluginListed(
  ports: SetupPorts,
): Promise<SetupPluginListed> {
  const out = await ports.process.read(
    setupPluginListCommand,
    setupProbeWaitMs,
    setupChildBytesMax,
  );
  const list = setupPluginListSchema.safeParse(
    out === undefined ? undefined : setupPluginJson(out),
  );
  if (!list.success) return { listed: "Unread" };
  const entries = list.data.flatMap((entry) => {
    const read = setupPluginEntrySchema.safeParse(entry);
    return read.success && read.data.id === setupPluginId ? [read.data] : [];
  });
  const entry = entries.find((had) => had.enabled) ?? entries[0];
  if (entry === undefined) return { listed: "None" };
  return {
    listed: "Had",
    enabled: entry.enabled,
    folder: entry.readFromFolder ?? entry.installPath,
  };
}

/** How the checklist has the plugin: passed over where the run's answers say so, without asking Claude Code, and otherwise as its list says, which is none where the list could not be read. */
export async function setupPluginHad(
  ports: SetupPorts,
  answers: SetupAnswers,
): Promise<SetupPluginHere> {
  if (answers.plugin === setupPluginSkip) return "Skipped";
  const listed = await setupPluginListed(ports);
  if (listed.listed !== "Had") return "None";
  return listed.enabled ? "On" : "Off";
}

/** Runs one of the plugin's commands, answering nothing where its last line says it ended well, and otherwise how it failed. */
async function setupPluginActed(
  ports: SetupPorts,
  act: keyof typeof setupPluginCommands,
): Promise<SetupPluginEnded | undefined> {
  const acted = await setupActed(
    { ports, secrets: [] },
    act,
    setupPluginCommands[act],
  );
  if ("halt" in acted) {
    if (acted.halt.stop !== "Act")
      throw new Error(`setupPluginActed: ${acted.halt.stop}`);
    return { ended: "Failed", act, failed: acted.halt.failed };
  }
  const last = acted.out.trimEnd().split("\n").at(-1) ?? "";
  const result = setupPluginResultSchema.safeParse(setupPluginJson(last));
  if (result.success && result.data.outcome === "ok") return undefined;
  const said = result.success ? (result.data.message ?? last) : last;
  return {
    ended: "Failed",
    act,
    failed: { how: "Exit", exit: 0, excerpt: setupExcerpt(said, []) },
  };
}

/** Runs the plugin's commands in order, answering how the first that failed did, or nothing where each ended well. */
async function setupPluginActedEach(
  ports: SetupPorts,
  acts: readonly (keyof typeof setupPluginCommands)[],
): Promise<SetupPluginEnded | undefined> {
  for (const act of acts) {
    const failed = await setupPluginActed(ports, act);
    if (failed !== undefined) return failed;
  }
  return undefined;
}

/** The version `claude --version` printed first, where it printed one. */
export function setupPluginClaudeVersion(said: string): string | undefined {
  return /^(\d+\.\d+\.\d+)(?![\d.])/u.exec(said.trim())?.[1];
}

/** The plugin installed where it is not, updated with its marketplace where it is, then enabled where the list says it is off, and the list read again. */
async function setupPluginEnded(ports: SetupPorts): Promise<SetupPluginEnded> {
  const said = await ports.process.read(
    setupPluginVersionCommand,
    setupProbeWaitMs,
    setupChildBytesMax,
  );
  if (said === undefined) return { ended: "Claudeless" };
  const version = setupPluginClaudeVersion(said);
  const least = setupPluginClaudeLeast;
  if (
    version === undefined ||
    !setupPackageCurrent({ command: "claude", version }, least)
  )
    return { ended: "Old", version, least };
  const before = await setupPluginListed(ports);
  const had = before.listed === "Had";
  const failed = await setupPluginActedEach(
    ports,
    had
      ? ["PluginMarketplaceUpdate", "PluginUpdate"]
      : ["PluginMarketplaceAdd", "PluginInstall"],
  );
  if (failed !== undefined) return failed;
  const listed = await setupPluginListed(ports);
  if (listed.listed !== "Had") return { ended: "Unlisted" };
  const did: SetupPluginDid = had ? "Updated" : "Installed";
  if (listed.enabled) return { ended: "On", did, folder: listed.folder };
  const unenabled = await setupPluginActed(ports, "PluginEnable");
  if (unenabled !== undefined) return unenabled;
  const after = await setupPluginListed(ports);
  if (after.listed !== "Had") return { ended: "Unlisted" };
  return after.enabled
    ? { ended: "On", did: "Enabled", folder: after.folder }
    : { ended: "Off" };
}

export type SetupPluginAsked = Extract<
  SetupAsked,
  { readonly asked: "Plugin" }
>;

/** One run of `plugin`, to its report. */
export async function setupPlugin(
  ports: SetupPorts,
  asked: SetupPluginAsked,
): Promise<SetupReport> {
  return {
    report: "Plugin",
    site: asked.site,
    ended: await setupPluginEnded(ports),
  };
}
