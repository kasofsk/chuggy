/**
 * The MCP step and `mcp`, the command that does it: chuggy's MCP server, the
 * runner package's own `mcp` command for one project, named in the
 * configuration of the person's agent, Claude Code, for the folder the program
 * was run in.
 *
 * The server signs in through the store the worker contract's
 * `signInStore.ts` defines, which is where this program keeps its own
 * sign-in, so a person this program signed in is signed in for the server
 * too and nothing here signs in at all. `mcp` installs the platform's runner
 * package where none it can use is found, on Linux none that a later step can
 * use, which is why `runner` finds it installed there, and then has Claude
 * Code's own `claude mcp add` name the
 * server in the folder's local configuration, removing first one of the same
 * name there that names something else. Both change the machine, so `mcp` is
 * offered and never run unasked.
 *
 * The configuration is read and never written here: Claude Code keeps a
 * folder's local servers and the person's own in one file, under the folder
 * git names as the checkout's top where it is in one, and a checkout's shared
 * servers in a file at that top. A server named in the local configuration is
 * the one the agent runs over one of the same name in either other, and one
 * shared with the checkout over the person's own. The step is done where the
 * server the agent would run names this project of this site, run by the
 * program of the package `mcp` installs, which is the platform's own: each
 * keeps its sign-ins in the store.
 */

import { z } from "zod";

import { runnerPackages } from "./runners.ts";
import type { RunnerPackage } from "./runners.ts";
import type { SetupAsked } from "./setupArguments.ts";
import { setupPlatformServed } from "./setupPorts.ts";
import type { SetupPlatform, SetupPorts } from "./setupPorts.ts";
import type { SetupReport } from "./setupReport.ts";
import { setupActedStop, setupPackageReady } from "./setupRunner.ts";
import {
  setupChatPackageLeast,
  setupChildBytesMax,
  setupPackageCurrent,
  setupPackageProbed,
  setupProbeWaitMs,
  setupRunnerPlaces,
} from "./setupRunnerMachine.ts";
import type { SetupRunnerNote, SetupServerEnded } from "./setupRunnerSaid.ts";
import { setupSessionSite } from "./setupStore.ts";
import { setupFlat } from "./setupText.ts";

/** A runner package `mcp` installs and runs the server with, and the oldest of it `mcp` leaves a machine on. */
export interface SetupServerPackage {
  readonly offered: RunnerPackage;
  readonly least: string;
}

/**
 * The package `mcp` installs on each platform. Linux's least is the oldest
 * any later step's command can use, so `runner` and `chat-host` find it
 * installed; a Mac's is the first whose `mcp` keeps its sign-ins in the store.
 */
export const setupServerPackages: Readonly<
  Record<SetupPlatform, SetupServerPackage>
> = {
  linux: { offered: runnerPackages.linux, least: setupChatPackageLeast },
  darwin: { offered: runnerPackages.darwin, least: "0.23.0" },
};

/** The platform the program runs on, which `setupRun` has already refused where it is not one served. */
export function setupServerPlatform(ports: SetupPorts): SetupPlatform {
  const platform = setupPlatformServed(ports.surroundings.platform);
  if (platform === undefined)
    throw new Error(`unserved platform ${ports.surroundings.platform}`);
  return platform;
}

function setupServerPackage(ports: SetupPorts): SetupServerPackage {
  return setupServerPackages[setupServerPlatform(ports)];
}

/** The name the server is given in the agent's configuration. */
export const setupServerName = "chuggy";

/** Past any configuration Claude Code keeps for a person. */
export const setupAgentConfigBytesMax = 67_108_864;

/** The project the server is for, at the site it signs in to. */
export interface SetupServerFor {
  readonly site: string;
  readonly workspace: string;
  readonly project: string;
}

/** What the server is run with, after the program that runs it. */
export function setupServerArguments(at: SetupServerFor): readonly string[] {
  return [
    "mcp",
    "--site",
    at.site,
    "--workspace",
    at.workspace,
    "--project",
    at.project,
  ];
}

/** Claude Code's own command that names the server in the folder's local configuration, run as `command`. */
export function setupServerAddCommand(
  command: string,
  at: SetupServerFor,
): readonly string[] {
  return [
    "claude",
    "mcp",
    "add",
    "--scope",
    "local",
    setupServerName,
    "--",
    command,
    ...setupServerArguments(at),
  ];
}

/** Claude Code's own command that removes the server of that name from the folder's local configuration. */
export const setupServerRemoveCommand: readonly string[] = [
  "claude",
  "mcp",
  "remove",
  "--scope",
  "local",
  setupServerName,
];

/** What git is asked of the folder: the top of the checkout it is in. */
export const setupCheckoutTopCommand: readonly string[] = [
  "git",
  "rev-parse",
  "--show-toplevel",
];

const setupServersSchema = z.record(z.string(), z.unknown()).optional();

const setupAgentConfigSchema = z.looseObject({
  mcpServers: setupServersSchema,
  projects: z
    .record(z.string(), z.looseObject({ mcpServers: setupServersSchema }))
    .optional(),
});

const setupSharedConfigSchema = z.looseObject({
  mcpServers: setupServersSchema,
});

const setupServerSchema = z.looseObject({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
});

/** Where the agent's configuration was read, and what it says of the server. */
export interface SetupAgentRead {
  /** The file the folder's local configuration is kept in. */
  readonly path: string;
  /** Whether the server the agent would run is chuggy's for the project. */
  readonly named: boolean;
  /** Whether the folder's local configuration names a server of that name at all. */
  readonly local: boolean;
}

function setupAgentJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The folder Claude Code keeps a folder's configuration under: the checkout's top where git names one, and the folder itself otherwise. */
async function setupAgentFolder(ports: SetupPorts): Promise<string> {
  const top = (
    await ports.process.read(
      setupCheckoutTopCommand,
      setupProbeWaitMs,
      setupChildBytesMax,
    )
  )?.trim();
  return top !== undefined && top.startsWith("/") && setupFlat(top) === top
    ? top
    : ports.surroundings.folder;
}

/** Whether a server as the configuration holds it is chuggy's for the project, run by the program `mcp` installs, there to run. */
function setupServerNames(
  ports: SetupPorts,
  server: unknown,
  at: SetupServerFor,
): boolean {
  const read = setupServerSchema.safeParse(server);
  if (!read.success) return false;
  const { command, args = [] } = read.data;
  const program = command.slice(command.lastIndexOf("/") + 1);
  if (program !== setupServerPackage(ports).offered.program) return false;
  if (command.includes("/") && ports.disk.kind(command) !== "File")
    return false;
  const wanted = setupServerArguments(at);
  return (
    args.length === wanted.length &&
    args.every((arg, index) => arg === wanted[index])
  );
}

/** Reads the agent's configuration for the folder, and changes nothing. */
export async function setupAgentRead(
  ports: SetupPorts,
  at: SetupServerFor,
): Promise<SetupAgentRead> {
  const { home, claudeHome } = ports.surroundings;
  const base = claudeHome ?? home;
  const path = `${base ?? ""}/.claude.json`;
  if (base === undefined) return { path, named: false, local: false };
  const folder = await setupAgentFolder(ports);
  const config = setupAgentConfigSchema.safeParse(
    setupAgentJson(ports.disk.text(path, setupAgentConfigBytesMax)),
  );
  const shared = setupSharedConfigSchema.safeParse(
    setupAgentJson(
      ports.disk.text(`${folder}/.mcp.json`, setupAgentConfigBytesMax),
    ),
  );
  const own = config.success ? config.data : undefined;
  const local = own?.projects?.[folder]?.mcpServers?.[setupServerName];
  const server =
    local ??
    (shared.success ? shared.data.mcpServers?.[setupServerName] : undefined) ??
    own?.mcpServers?.[setupServerName];
  return {
    path,
    named: setupServerNames(ports, server, at),
    local: local !== undefined,
  };
}

export type SetupServerAsked = Extract<SetupAsked, { readonly asked: "Mcp" }>;

/** The server named for the project, once the package is had: as it was found, or added now. */
async function setupServerHad(
  ports: SetupPorts,
  at: SetupServerFor,
  command: string,
  notes: SetupRunnerNote[],
): Promise<SetupServerEnded> {
  const before = await setupAgentRead(ports, at);
  if (before.named) {
    notes.push({ note: "ServerFound", path: before.path });
    return { ended: "Served" };
  }
  const removed = before.local
    ? await setupActedStop(ports, "ServerRemoved", setupServerRemoveCommand)
    : undefined;
  if (removed !== undefined) return { ended: "Stopped", stop: removed };
  const added = await setupActedStop(
    ports,
    "ServerAdded",
    setupServerAddCommand(command, at),
  );
  if (added !== undefined) return { ended: "Stopped", stop: added };
  const after = await setupAgentRead(ports, at);
  if (!after.named)
    return {
      ended: "Stopped",
      stop: { stop: "Unseen", act: "ServerAdded", path: after.path },
    };
  notes.push({ note: "ServerAdded", path: after.path });
  return { ended: "Served" };
}

/** What `mcp` finds of the platform's runner package here: one it leaves as it is, one it replaces, or none. */
export type SetupMcpPackaged = "Current" | "Behind" | "Absent";

/** The platform's runner package here as `mcp` would find it, looked for and not touched. */
export async function setupMcpPackaged(
  ports: SetupPorts,
): Promise<SetupMcpPackaged> {
  if (ports.surroundings.home === undefined) return "Absent";
  const { offered, least } = setupServerPackage(ports);
  const found = (
    await setupPackageProbed(
      ports,
      setupRunnerPlaces(ports.surroundings),
      least,
      offered,
    )
  ).found;
  if (found === undefined) return "Absent";
  return setupPackageCurrent(found, least) ? "Current" : "Behind";
}

/** One run of `mcp`, to its report, at the site it was given or the one remembered. */
export async function setupServer(
  ports: SetupPorts,
  asked: SetupServerAsked,
): Promise<SetupReport> {
  const { workspace, project } = asked;
  const site = asked.site ?? setupSessionSite(ports.files);
  if (site === undefined) return { report: "SiteUnknown" };
  const at: SetupServerFor = { site, workspace, project };
  const notes: SetupRunnerNote[] = [];
  const { offered, least } = setupServerPackage(ports);
  const packaged = await setupPackageReady(
    ports,
    setupRunnerPlaces(ports.surroundings),
    notes,
    least,
    offered,
  );
  const ended =
    "stop" in packaged
      ? ({ ended: "Stopped", stop: packaged.stop } as const)
      : await setupServerHad(ports, at, packaged.command, notes);
  return { report: "Mcp", site, workspace, project, notes, ended };
}
