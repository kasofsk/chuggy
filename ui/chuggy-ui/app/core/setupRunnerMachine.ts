/**
 * What `runner` reads of the machine it is run on, each a probe that changes
 * nothing, and the commands it runs there, each as the words it is run with.
 *
 * The machine is the record of the machine's things: whether a container
 * engine answers this user, where the runner package is, what its settings
 * name, whether it is registered for a project, whether its service is there
 * and running. Nothing of that is kept by this program, so every run reads it
 * again. The names are the runner package's own, since it has no command that
 * says them: where it keeps its settings, its Claude login, a pool file and a
 * unit, and how it names a pool file for a project and the unit for a pool
 * file. A settings file is read for the engine and the Claude login it names
 * and for nothing else, and a pool file and a Claude login are never read at
 * all, only looked for. The package is installed by the console's own install
 * command, under the person's own prefix where the machine's is not theirs to
 * write.
 */

import { z } from "zod";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import { runnerPackageOffered, runnerRegisterCommand } from "./runners.ts";
import { SetupMachineError } from "./setupPorts.ts";
import type {
  SetupChildEnded,
  SetupPorts,
  SetupSurroundings,
} from "./setupPorts.ts";
import {
  setupEngines,
  setupJobUser,
  setupRegisterRefusal,
} from "./setupRunnerSaid.ts";
import type {
  SetupChildFailed,
  SetupDockerBarred,
  SetupEngine,
  SetupEngineAsked,
} from "./setupRunnerSaid.ts";
import { setupExcerpt, setupFlat } from "./setupText.ts";

/** How long a probe of the machine is waited on, which bounds a hang and not an answer. */
export const setupProbeWaitMs = 20_000;

/** The most of either stream of another program that is kept. */
export const setupChildBytesMax = 65_536;

/** Past any settings file or package manifest a person would write. */
const setupTextBytesMax = 65_536;

const setupProgram = runnerPackageOffered.program;

/** The platform `runner` sets a runner up on, which is the one the console's package runs on. */
export const setupRunnerPlatform = "linux";

/** Where the runner package keeps its things on this machine, each a whole path. */
export interface SetupRunnerPlaces {
  readonly settings: string;
  /** Where the runner's Claude login is kept unless its settings name another place. */
  readonly login: string;
  readonly pools: string;
  readonly units: string;
  /** The prefix of the person's own the package is installed under where the machine's is not theirs to write. */
  readonly own: string;
}

function setupPath(...parts: readonly string[]): string {
  return parts.join("/");
}

/** The package's places under the person's configuration directory, which is the one they set where it is a whole path and the usual one in their home otherwise. */
export function setupRunnerPlaces(
  surroundings: SetupSurroundings,
): SetupRunnerPlaces {
  const { home, configHome } = surroundings;
  if (home === undefined) throw new SetupMachineError({ fault: "Homeless" });
  const config =
    configHome !== undefined && configHome.startsWith("/")
      ? configHome.replace(/\/+$/u, "")
      : setupPath(home, ".config");
  return {
    settings: setupPath(config, setupProgram, "runner.json"),
    login: setupPath(config, setupProgram, "claude-token"),
    pools: setupPath(config, "chuggy", "pools"),
    units: setupPath(config, "systemd", "user"),
    own: setupPath(home, ".local"),
  };
}

/** A program's failure as a report holds it, or nothing where it ended well: what it printed is kept only as an excerpt the redactor has been through. */
export function setupChildFailed(
  ended: SetupChildEnded,
  waitMs: number,
  secrets: readonly string[],
): SetupChildFailed | undefined {
  switch (ended.ended) {
    case "Unstarted":
      return { how: "Unstarted" };
    case "Unended":
      return { how: "Unended", secs: Math.round(waitMs / 1_000) };
    case "Exited":
      return ended.exit === 0
        ? undefined
        : {
            how: "Exit",
            exit: ended.exit,
            excerpt: setupExcerpt(
              ended.err.trim() === "" ? ended.out : ended.err,
              secrets,
            ),
          };
  }
}

/**
 * The failure of the one program handed the registration token, or nothing
 * where it ended well. No redactor finds a token said back in pieces, so
 * nothing it printed is kept: only which of the package's refusals it named.
 */
export function setupRegisterFailed(
  ended: SetupChildEnded,
  waitMs: number,
): SetupChildFailed | undefined {
  if (ended.ended !== "Exited") return setupChildFailed(ended, waitMs, []);
  if (ended.exit === 0) return undefined;
  const refusal = setupRegisterRefusal(ended.err);
  return { how: "ExitUnquoted", exit: ended.exit, refusal };
}

function setupProbed(
  ports: SetupPorts,
  command: readonly string[],
): Promise<SetupChildEnded> {
  return ports.process.run(command, setupProbeWaitMs, setupChildBytesMax);
}

function setupWell(ended: SetupChildEnded): boolean {
  return ended.ended === "Exited" && ended.exit === 0;
}

/** What each engine is asked that only one this user can reach answers well. */
const setupEngineProbes: Readonly<Record<SetupEngine, readonly string[]>> = {
  docker: ["docker", "version", "--format", "{{.Server.Version}}"],
  podman: ["podman", "info", "--format", "{{.Host.Os}}"],
};

/**
 * Where a runner could be put: here, with the engine that answered; or not
 * here, because the machine is not the package's platform, its user services
 * did not answer, no engine did, or the package bars this user from docker
 * and nothing else is theirs to use.
 */
export type SetupRunnerRoom =
  | { readonly room: "Open"; readonly engine: SetupEngine }
  | { readonly room: "Mac" }
  | { readonly room: "Serviceless" }
  | {
      readonly room: "Engineless";
      readonly asked: readonly SetupEngineAsked[];
    }
  | {
      readonly room: "DockerBarred";
      readonly user: string | undefined;
      readonly how: SetupDockerBarred;
    };

/** The runner's settings where the machine has ones that read, which is where an engine is already named. */
export type SetupSettingsNamed = Extract<
  SetupSettingsRead,
  { readonly settings: "Read" }
>;

async function setupEngineAsked(
  ports: SetupPorts,
  engine: SetupEngine,
): Promise<SetupEngineAsked> {
  const ended = await setupProbed(ports, setupEngineProbes[engine]);
  if (setupWell(ended)) return { engine, answered: "Yes" };
  return { engine, answered: ended.ended === "Unstarted" ? "Absent" : "No" };
}

/** What leaves a user the package bars from docker with no engine, or nothing where podman answers them; podman is asked only where no settings name an engine. */
async function setupBarredHow(
  ports: SetupPorts,
  named: SetupSettingsNamed | undefined,
): Promise<SetupDockerBarred | undefined> {
  if (named !== undefined) return { barred: "Named", settings: named.path };
  const { answered } = await setupEngineAsked(ports, "podman");
  return answered === "Yes" ? undefined : { barred: "Podmanless", answered };
}

/**
 * The package takes docker only from the user its jobs run as. Any other is
 * never asked docker, so podman is what is found for them, or no engine at all.
 */
async function setupEngineRoom(
  ports: SetupPorts,
  named: SetupSettingsNamed | undefined,
): Promise<SetupRunnerRoom> {
  const user = ports.surroundings.user;
  if (user !== setupJobUser && named?.engine !== "podman") {
    const how = await setupBarredHow(ports, named);
    return how === undefined
      ? { room: "Open", engine: "podman" }
      : { room: "DockerBarred", user, how };
  }
  const asked: SetupEngineAsked[] = [];
  for (const engine of named === undefined ? setupEngines : [named.engine]) {
    const answer = await setupEngineAsked(ports, engine);
    if (answer.answered === "Yes") return { room: "Open", engine };
    asked.push(answer);
  }
  return { room: "Engineless", asked };
}

/** Asks the user's service manager for its own version, which it answers only where it is running for this user. */
const setupServicesProbe = [
  "systemctl",
  "--user",
  "show",
  "--property",
  "Version",
];

/** Whether this machine could take a runner, asking the one engine the runner's settings name where there are any, and otherwise each the package would take from this user. */
export async function setupRunnerRoom(
  ports: SetupPorts,
  named: SetupSettingsNamed | undefined,
): Promise<SetupRunnerRoom> {
  if (ports.surroundings.platform !== setupRunnerPlatform)
    return { room: "Mac" };
  if (!setupWell(await setupProbed(ports, setupServicesProbe)))
    return { room: "Serviceless" };
  return setupEngineRoom(ports, named);
}

/** What a settings file names that this program goes by, the rest of it never held: `environment` there may carry a person's secrets. */
const setupSettingsSchema = z.object({
  claudeTokenFile: z.string().startsWith("/"),
  engine: z.enum(setupEngines).optional(),
});

/** The runner's settings: none yet, there and not read as the package's, or the engine and the Claude login they name. */
export type SetupSettingsRead =
  | { readonly settings: "Absent" }
  | { readonly settings: "Unread" }
  | {
      readonly settings: "Read";
      readonly path: string;
      readonly engine: SetupEngine;
      readonly login: string;
    };

function setupJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Settings that name no engine run the package's default, which is the first it lists. */
export function setupSettingsRead(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
): SetupSettingsRead {
  if (ports.disk.kind(places.settings) === "None")
    return { settings: "Absent" };
  const parsed = setupSettingsSchema.safeParse(
    setupJson(ports.disk.text(places.settings, setupTextBytesMax)),
  );
  return parsed.success
    ? {
        settings: "Read",
        path: places.settings,
        engine: parsed.data.engine ?? setupEngines[0],
        login: parsed.data.claudeTokenFile,
      }
    : { settings: "Unread" };
}

/** The limits the package's guide writes in the settings it shows, which have no default of the package's own. */
const setupGuideLimits = { timeoutSecsMax: 7_200, outputBytesMax: 1_048_576 };

/** The settings a machine with none is given: the package's guide's own, with the engine that answered and where the Claude login is. */
export function setupSettingsText(engine: SetupEngine, login: string): string {
  const settings = {
    engine,
    concurrencyMax: 1,
    sessionsMax: 2,
    claudeTokenFile: login,
    ...setupGuideLimits,
    environment: {},
    network: "chuggy-jobs",
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The runner package where it is installed: its command by its whole path, and the version its manifest names. */
export interface SetupPackageFound {
  readonly command: string;
  readonly version: string | undefined;
}

export interface SetupPackageProbe {
  readonly found: SetupPackageFound | undefined;
  /** The prefix npm installs machine-wide under, or nothing where npm did not say. */
  readonly prefix: string | undefined;
  /** Whether that prefix is this user's to write, which is whether an install there needs no password. */
  readonly mine: boolean;
}

const setupVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/u),
});

function setupCommandIn(prefix: string): string {
  return setupPath(prefix, "bin", setupProgram);
}

function setupPackageIn(
  ports: SetupPorts,
  prefix: string,
): SetupPackageFound | undefined {
  const command = setupCommandIn(prefix);
  if (ports.disk.kind(command) !== "File") return undefined;
  const manifest = setupPath(
    prefix,
    "lib",
    "node_modules",
    setupProgram,
    "package.json",
  );
  const read = setupVersionSchema.safeParse(
    setupJson(ports.disk.text(manifest, setupTextBytesMax)),
  );
  return { command, version: read.success ? read.data.version : undefined };
}

/** A prefix as npm printed it, where that is one whole path a line can say back unchanged. */
function setupPrefixRead(printed: string | undefined): string | undefined {
  const prefix = printed?.trim() ?? "";
  return prefix.startsWith("/") && setupFlat(prefix) === prefix
    ? prefix.replace(/\/+$/u, "")
    : undefined;
}

/** Where the runner package is: under the prefix npm installs machine-wide, or under the person's own. */
export async function setupPackageProbed(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
): Promise<SetupPackageProbe> {
  const prefix = setupPrefixRead(
    await ports.process.read(
      ["npm", "prefix", "-g"],
      setupProbeWaitMs,
      setupChildBytesMax,
    ),
  );
  const mine =
    prefix !== undefined &&
    ports.disk.writable(setupPath(prefix, "lib", "node_modules")) &&
    ports.disk.writable(setupPath(prefix, "bin"));
  const found =
    (prefix === undefined ? undefined : setupPackageIn(ports, prefix)) ??
    setupPackageIn(ports, places.own);
  return { found, prefix, mine };
}

/** Where an install would put the command, which is where it is looked for afterwards. */
export function setupInstallCommandPath(
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
): string {
  return setupCommandIn(
    probe.mine && probe.prefix !== undefined ? probe.prefix : places.own,
  );
}

/** The console's own install command, word for word, with the person's own prefix named where the machine's is not theirs to write. */
export function setupInstallCommand(
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
): readonly string[] {
  const words = runnerPackageOffered.installCommand.split(" ");
  return probe.mine
    ? words
    : [...words.slice(0, -1), "--prefix", places.own, ...words.slice(-1)];
}

/** The console's own register command, word for word, run as the installed command by its whole path. */
export function setupRegisterCommand(
  command: string,
  site: string,
  token: string,
): readonly string[] {
  const [, ...rest] = runnerRegisterCommand(
    runnerPackageOffered,
    site,
    token,
  ).split(" ");
  return [command, ...rest];
}

/** What the bare command reads of this machine where the runner's step is the one next: whether a runner could be put here, and whether it holds a registration for the project, which is a file's name and not yet whether the site knows it. */
export interface SetupRunnerHere {
  readonly room: SetupRunnerRoom;
  readonly held: boolean;
}

/** One part of a pool file's name as the package writes it: letters, digits and `-` as themselves, and every other octet by its number. */
function setupPoolNamePart(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((octet) => {
      const char = String.fromCharCode(octet);
      return /^[A-Za-z0-9-]$/u.test(char)
        ? char
        : `_${octet.toString(16).padStart(2, "0")}`;
    })
    .join("");
}

/** What every pool file of a project is named from, whatever the pool. */
export function setupPoolFilePrefix(partition: PartitionIdentity): string {
  return `${setupPoolNamePart(partition.tenant)}.${setupPoolNamePart(partition.project)}.`;
}

const setupPoolFileSuffix = ".json";

/** A pool's name as the package takes one, which a pool file's name carries as itself. */
const setupPoolNamed = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/** A registration of this machine as a pool of the project, by the file it left and the pool's name. */
export interface SetupPoolFile {
  readonly path: string;
  readonly pool: string;
}

/** The pool files this machine has for a project, found by their names and never opened, in the order of those names. */
export function setupPoolFiles(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
  partition: PartitionIdentity,
): readonly SetupPoolFile[] {
  const prefix = setupPoolFilePrefix(partition);
  return ports.disk
    .names(places.pools)
    .toSorted()
    .flatMap((name) => {
      if (!name.startsWith(prefix) || !name.endsWith(setupPoolFileSuffix))
        return [];
      const pool = name.slice(prefix.length, -setupPoolFileSuffix.length);
      const path = setupPath(places.pools, name);
      return setupPoolNamed.test(pool) && ports.disk.kind(path) === "File"
        ? [{ path, pool }]
        : [];
    });
}

/** Looks at the machine as `runner` would before it did anything, and changes nothing; a Mac is asked nothing at all. */
export async function setupRunnerHere(
  ports: SetupPorts,
  partition: PartitionIdentity,
): Promise<SetupRunnerHere> {
  if (ports.surroundings.platform !== setupRunnerPlatform)
    return { room: { room: "Mac" }, held: false };
  const places = setupRunnerPlaces(ports.surroundings);
  const settings = setupSettingsRead(ports, places);
  const room = await setupRunnerRoom(
    ports,
    settings.settings === "Read" ? settings : undefined,
  );
  return {
    room,
    held:
      room.room === "Open" &&
      setupPoolFiles(ports, places, partition).length > 0,
  };
}

/** The service of a pool file, as the package names it and where it writes it. */
export interface SetupUnit {
  readonly name: string;
  readonly path: string;
}

export function setupUnitOf(
  places: SetupRunnerPlaces,
  file: SetupPoolFile,
): SetupUnit {
  const base = file.path.slice(
    file.path.lastIndexOf("/") + 1,
    -setupPoolFileSuffix.length,
  );
  const name = `${setupProgram}-${base}.service`;
  return { name, path: setupPath(places.units, name) };
}

/** The commands of the installed package and of the machine's service manager that `runner` runs. */
export const setupRunnerCommands = {
  check: (command: string, file: SetupPoolFile): readonly string[] => [
    command,
    "doctor",
    "--pool",
    file.path,
  ],
  service: (command: string, file: SetupPoolFile): readonly string[] => [
    command,
    "install-service",
    "--pool",
    file.path,
  ],
  reload: ["systemctl", "--user", "daemon-reload"],
  start: (unit: SetupUnit): readonly string[] => [
    "systemctl",
    "--user",
    "enable",
    "--now",
    unit.name,
  ],
  restart: (unit: SetupUnit): readonly string[] => [
    "systemctl",
    "--user",
    "restart",
    unit.name,
  ],
} as const;

/** Whether a unit is what `verb` asks, and the one word the service manager said of it: empty where it said none, and nothing where it did not answer. */
export async function setupUnitIs(
  ports: SetupPorts,
  verb: "is-enabled" | "is-active",
  unit: SetupUnit,
): Promise<{ readonly is: boolean; readonly said: string | undefined }> {
  const ended = await setupProbed(ports, [
    "systemctl",
    "--user",
    verb,
    unit.name,
  ]);
  if (ended.ended !== "Exited") return { is: false, said: undefined };
  const said = setupFlat(ended.out);
  return { is: setupWell(ended), said: /^[a-z-]+$/u.test(said) ? said : "" };
}

/** Whether the person's services outlive a logout, as the login manager says, or nothing where it did not say. */
export async function setupLingerRead(
  ports: SetupPorts,
): Promise<"Yes" | "No" | "Unread"> {
  const user = ports.surroundings.user;
  if (user === undefined) return "Unread";
  const ended = await setupProbed(ports, [
    "loginctl",
    "show-user",
    user,
    "--property",
    "Linger",
  ]);
  if (ended.ended !== "Exited" || ended.exit !== 0) return "Unread";
  const said = /^Linger=(yes|no)$/mu.exec(ended.out)?.[1];
  return said === "yes" ? "Yes" : said === "no" ? "No" : "Unread";
}

/** Turns lingering on without leave to ask anyone for a password, for this user by number where the machine numbers them. */
export function setupLingerCommand(ports: SetupPorts): readonly string[] {
  const user = ports.surroundings.user;
  return [
    "loginctl",
    "--no-ask-password",
    "enable-linger",
    ...(user === undefined ? [] : [user]),
  ];
}

/** What a person runs in a terminal of their own to turn lingering on, where it may ask them for their password. */
export const setupLingerByHand = ["loginctl", "enable-linger"] as const;
