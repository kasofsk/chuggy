/**
 * What `runner` reads of the machine it is run on, each a probe that changes
 * nothing, and the commands it runs there, each as the words it is run with.
 *
 * The machine is the record of the machine's things: whether a container
 * engine answers this user, where the runner package is, what its settings
 * name, whether it is registered for a project or as the person's chat host,
 * whether a service is there and running. Nothing of that is kept by this
 * program, so every run reads it again. The names are the runner package's
 * own, since it has no command that says them: where it keeps its settings,
 * its Claude login, its registrations and its services' files, how it names a
 * pool file for a project and the file of the person's chat host in a
 * workspace, and the service of either: a systemd user unit on Linux, a
 * launchd agent on a Mac. A settings file is read for the engine and the Claude
 * credential it names and for nothing else, the chat host's file for the id
 * the site holds that host by and for nothing else, and a pool's registration
 * and a Claude credential's file are never read at all, only looked for. The
 * package is
 * installed by the console's own install command, under the person's own
 * prefix where the machine's is not theirs to write.
 */

import { z } from "zod";

import { identitySchema } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import { runnerPackages, runnerRegisterCommand } from "./runners.ts";
import type { RunnerKind, RunnerPackage } from "./runners.ts";
import { SetupMachineError, setupPlatformOf } from "./setupPorts.ts";
import type {
  SetupChildEnded,
  SetupPlatform,
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
  SetupClaudeCredential,
  SetupClaudeKind,
  SetupDockerBarred,
  SetupEngine,
  SetupEngineAsked,
} from "./setupRunnerSaid.ts";
import { setupExcerpt, setupFlat } from "./setupText.ts";

/** How long a probe of the machine is waited on, which bounds a hang and not an answer. */
export const setupProbeWaitMs = 20_000;

/** The most of either stream of another program that is kept. */
export const setupChildBytesMax = 65_536;

/** Past any settings file, package manifest or unit a person would write. */
const setupTextBytesMax = 65_536;

/** Where the runner package keeps its things on this machine, each a whole path. */
export interface SetupRunnerPlaces {
  readonly settings: string;
  /** Where the runner's Claude login is kept unless its settings name another place: alone in a directory of its own, which a chat host is handed whole. */
  readonly login: string;
  readonly pools: string;
  /** Where the package writes the file of each service it runs: its systemd user units on Linux, its launchd agents on a Mac. */
  readonly units: string;
  /** The prefix of the person's own the package is installed under where the machine's is not theirs to write. */
  readonly own: string;
}

function setupPath(...parts: readonly string[]): string {
  return parts.join("/");
}

/**
 * The package's places: on Linux under the person's configuration directory,
 * the one they set where it is a whole path and the usual one in their home
 * otherwise. On a Mac under their Library, but for the pool files, which
 * chuggy-darwin keeps in `~/.config` whatever configuration directory is set.
 */
export function setupRunnerPlaces(
  surroundings: SetupSurroundings,
): SetupRunnerPlaces {
  const { home, configHome } = surroundings;
  if (home === undefined) throw new SetupMachineError({ fault: "Homeless" });
  const own = setupPath(home, ".local");
  const platform = setupPlatformOf(surroundings);
  const program = runnerPackages[platform].program;
  if (platform === "darwin") {
    const support = setupPath(home, "Library", "Application Support", program);
    return {
      settings: setupPath(support, "runner.json"),
      login: setupPath(support, "claude", "token"),
      pools: setupPath(home, ".config", "chuggy", "pools"),
      units: setupPath(home, "Library", "LaunchAgents"),
      own,
    };
  }
  const config =
    configHome !== undefined && configHome.startsWith("/")
      ? configHome.replace(/\/+$/u, "")
      : setupPath(home, ".config");
  return {
    settings: setupPath(config, program, "runner.json"),
    login: setupPath(config, program, "claude", "token"),
    pools: setupPath(config, "chuggy", "pools"),
    units: setupPath(config, "systemd", "user"),
    own,
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
 * here, because its user services did not answer, no engine did, or the
 * package bars this user from docker and nothing else is theirs to use. Only
 * Linux has the first and the last: a Mac's runner has launchd, and docker in
 * Colima for any user.
 */
export type SetupRunnerRoom =
  | { readonly room: "Open"; readonly engine: SetupEngine }
  | { readonly room: "Serviceless" }
  | {
      readonly room: "Engineless";
      readonly asked: readonly SetupEngineAsked[];
      /** The command that starts the engine without a password where it runs in a VM of the person's, as docker does in Colima on a Mac. */
      readonly start: string | undefined;
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
  return { room: "Engineless", asked, start: undefined };
}

/** Asks the user's service manager for its own version, which it answers only where it is running for this user. */
const setupServicesProbe = [
  "systemctl",
  "--user",
  "show",
  "--property",
  "Version",
];

/** What starts Colima, the VM docker runs in on a Mac, which is the person's to start and never this program's. */
export const setupColimaStart = ["colima", "start"] as const;

/** What starts Colima whenever the person logs in, as chuggy-darwin's `install-agent` says it. */
export const setupColimaAtLogin = [
  "brew",
  "services",
  "start",
  "colima",
] as const;

/**
 * Whether this machine could take a runner: on a Mac whether docker, the one
 * engine chuggy-darwin runs, answers. On Linux it asks the one engine the
 * runner's settings name where there are any, and otherwise each the package
 * would take from this user.
 */
export async function setupRunnerRoom(
  ports: SetupPorts,
  named: SetupSettingsNamed | undefined,
): Promise<SetupRunnerRoom> {
  if (setupPlatformOf(ports.surroundings) === "darwin") {
    const asked = await setupEngineAsked(ports, "docker");
    return asked.answered === "Yes"
      ? { room: "Open", engine: "docker" }
      : {
          room: "Engineless",
          asked: [asked],
          start: setupColimaStart.join(" "),
        };
  }
  if (!setupWell(await setupProbed(ports, setupServicesProbe)))
    return { room: "Serviceless" };
  return setupEngineRoom(ports, named);
}

const setupWholePath = z.string().startsWith("/");

/** A Claude credential as the package's settings name one: its kind, and its one file under the key that kind names it by. */
const setupCredentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Subscription"), tokenFile: setupWholePath }),
  z.object({ kind: z.literal("ApiKey"), apiKeyFile: setupWholePath }),
  z.object({
    kind: z.literal("Bedrock"),
    apiKeyFile: setupWholePath.optional(),
    credentialsFile: setupWholePath.optional(),
    profile: z.string().optional(),
  }),
  z.object({ kind: z.literal("Vertex"), credentialsFile: setupWholePath }),
  z.object({ kind: z.literal("Foundry"), apiKeyFile: setupWholePath }),
]);

/** What a settings file names that this program goes by, the rest of it never held: `environment` there may carry a person's secrets. */
const setupSettingsSchema = z.object({
  claudeTokenFile: setupWholePath.optional(),
  claudeCredential: setupCredentialSchema.optional(),
  engine: z.enum(setupEngines).optional(),
});

/**
 * A credential the package's settings name, where they name it as the package
 * takes it: one file, and of a Bedrock credential either a Bedrock API key's
 * file or an AWS credentials file and the profile of it to read, `default`
 * where none is named.
 */
function setupCredentialHeld(
  credential: z.infer<typeof setupCredentialSchema>,
): SetupClaudeCredential | undefined {
  switch (credential.kind) {
    case "Subscription":
      return { kind: "Subscription", path: credential.tokenFile };
    case "Bedrock": {
      const { apiKeyFile, credentialsFile, profile } = credential;
      if (credentialsFile !== undefined)
        return apiKeyFile === undefined
          ? {
              kind: "Bedrock",
              path: credentialsFile,
              profile: profile ?? "default",
            }
          : undefined;
      return apiKeyFile !== undefined && profile === undefined
        ? { kind: "Bedrock", path: apiKeyFile, profile: undefined }
        : undefined;
    }
    case "Vertex":
      return { kind: "Vertex", path: credential.credentialsFile };
    case "ApiKey":
    case "Foundry":
      return { kind: credential.kind, path: credential.apiKeyFile };
  }
}

/** The Claude credential settings name, where they name one as the package takes it: `claudeTokenFile`, a subscription's, or `claudeCredential`, of any kind, and never both. */
function setupCredentialNamed(
  named: z.infer<typeof setupSettingsSchema>,
): SetupClaudeCredential | undefined {
  const { claudeTokenFile, claudeCredential } = named;
  if (claudeCredential === undefined)
    return claudeTokenFile === undefined
      ? undefined
      : { kind: "Subscription", path: claudeTokenFile };
  return claudeTokenFile === undefined
    ? setupCredentialHeld(claudeCredential)
    : undefined;
}

/** The runner's settings: none yet, there and not read as the package's, or the engine and the Claude credential they name. */
export type SetupSettingsRead =
  | { readonly settings: "Absent" }
  | { readonly settings: "Unread" }
  | {
      readonly settings: "Read";
      readonly path: string;
      readonly engine: SetupEngine;
      readonly credential: SetupClaudeCredential;
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
  const credential = parsed.success
    ? setupCredentialNamed(parsed.data)
    : undefined;
  return parsed.success && credential !== undefined
    ? {
        settings: "Read",
        path: places.settings,
        engine: parsed.data.engine ?? setupEngines[0],
        credential,
      }
    : { settings: "Unread" };
}

/** The limits the package's guide writes in the settings it shows, which have no default of the package's own. */
const setupGuideLimits = { timeoutSecsMax: 7_200, outputBytesMax: 1_048_576 };

/** The settings a machine with none is given: the package's guide's own, with where the Claude login is and, on Linux, the engine that answered; chuggy-darwin's settings have no engine to name. */
export function setupSettingsText(
  platform: SetupPlatform,
  engine: SetupEngine,
  login: string,
): string {
  const settings = {
    ...(platform === "darwin" ? {} : { engine }),
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

/**
 * The first version of the runner package that updates itself to the release
 * chuggy names for it, which is the oldest a run leaves a machine on: whatever
 * a later chuggy needs of the package reaches a machine at or past it by that
 * update, and never one below it.
 */
export const setupPackageLeast = "0.14.0";

/** The first version of the runner package that registers a chat host, which a run that sets one up leaves a machine on. */
export const setupChatPackageLeast = "0.35.0";

/**
 * The oldest of each platform's runner package a run can use: `pool` for the
 * project's runner alone, `chat` where the person's chat host is set up too.
 * Linux's are the two above; chuggy-darwin's are its first release with every
 * command a run uses.
 */
export const setupPackageLeasts: Readonly<
  Record<SetupPlatform, { readonly pool: string; readonly chat: string }>
> = {
  linux: { pool: setupPackageLeast, chat: setupChatPackageLeast },
  darwin: { pool: "0.23.0", chat: "0.23.0" },
};

function setupVersionParts(version: string): readonly number[] {
  return version.split(/[.+-]/u, 3).map(Number);
}

/** Whether a package found is one a run can use: its version read, and none older than `least`. */
export function setupPackageCurrent(
  found: SetupPackageFound,
  least: string,
): boolean {
  if (found.version === undefined) return false;
  const had = setupVersionParts(found.version);
  const floor = setupVersionParts(least);
  const at = had.findIndex((part, index) => part !== floor[index]);
  return at < 0 || (had[at] ?? 0) > (floor[at] ?? 0);
}

/** The later of two versions, as `setupPackageCurrent` orders them. */
export function setupVersionLater(one: string, other: string): string {
  return setupPackageCurrent({ command: "", version: one }, other)
    ? one
    : other;
}

function setupCommandIn(prefix: string, offered: RunnerPackage): string {
  return setupPath(prefix, "bin", offered.program);
}

function setupPackageIn(
  ports: SetupPorts,
  prefix: string,
  offered: RunnerPackage,
): SetupPackageFound | undefined {
  const command = setupCommandIn(prefix, offered);
  if (ports.disk.kind(command) !== "File") return undefined;
  const manifest = setupPath(
    prefix,
    "lib",
    "node_modules",
    offered.program,
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

/** Where the runner package `offered` is: under the prefix npm installs machine-wide, or under the person's own, and where both hold one, the one a run can use, none older than `least`. */
export async function setupPackageProbed(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
  least: string,
  offered: RunnerPackage,
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
  const held = [
    prefix === undefined ? undefined : setupPackageIn(ports, prefix, offered),
    setupPackageIn(ports, places.own, offered),
  ].filter((there) => there !== undefined);
  const found =
    held.find((there) => setupPackageCurrent(there, least)) ?? held[0];
  return { found, prefix, mine };
}

/** The prefix an install puts the package under: npm's machine-wide one where it is this person's to write, and otherwise their own. */
function setupInstallPrefix(
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
): string {
  return probe.mine && probe.prefix !== undefined ? probe.prefix : places.own;
}

/** Where an install would put the command, which is where it is looked for afterwards. */
export function setupInstallCommandPath(
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
  offered: RunnerPackage,
): string {
  return setupCommandIn(setupInstallPrefix(places, probe), offered);
}

/** The package where an install puts one, whatever its version, or nothing where there is none. */
export function setupPackageInstalled(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
  offered: RunnerPackage,
): SetupPackageFound | undefined {
  return setupPackageIn(ports, setupInstallPrefix(places, probe), offered);
}

/** The console's own install command for `offered`, word for word, with the person's own prefix named where the machine's is not theirs to write. */
export function setupInstallCommand(
  places: SetupRunnerPlaces,
  probe: SetupPackageProbe,
  offered: RunnerPackage,
): readonly string[] {
  const words = offered.installCommand.split(" ");
  return probe.mine
    ? words
    : [...words.slice(0, -1), "--prefix", places.own, ...words.slice(-1)];
}

/** The console's own register command for `offered`, word for word, as a pool's or as the person's chat host, run as the installed command by its whole path. */
export function setupRegisterCommand(
  offered: RunnerPackage,
  command: string,
  site: string,
  token: string,
  kind: Exclude<RunnerKind, "Personal">,
): readonly string[] {
  const [, ...rest] = runnerRegisterCommand(offered, site, token, kind).split(
    " ",
  );
  return [command, ...rest];
}

/** What the bare command reads of this machine where the runner's step is the one next: whether a runner could be put here, and whether it holds a registration for the project and one as the person's chat host in its workspace, each a file's name and not yet whether the site knows it. */
export interface SetupRunnerHere {
  readonly room: SetupRunnerRoom;
  readonly held: boolean;
  readonly chat: boolean;
  /** The kind of Claude credential work here would run on: the one the settings name, a subscription's where there are none, and nothing where they were not read. */
  readonly claude: SetupClaudeKind | undefined;
}

/** One part of a registration's file name as the package writes it: letters, digits and `-` as themselves, and every other octet by its number. */
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

/** What the package ends a chat host's file's name with, after the workspace and the member. */
const setupChatFileSuffix = ".chat.host.json";

/** A pool's name as the package takes one, which a pool file's name carries as itself. */
const setupPoolNamed = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/** A registration of this machine, by the file it left. */
export interface SetupFile {
  readonly path: string;
}

/** A registration of this machine as a pool of the project, by the file it left and the pool's name. */
export interface SetupPoolFile extends SetupFile {
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

/** Every octet of a name part said as itself or by its number, and no `.`, which parts the name. */
const setupNamePart = /^(?:[A-Za-z0-9-]|_[0-9a-f]{2})+$/u;

/**
 * The files this machine has of the person's chat host in a workspace, found
 * by their names, in the order of those names. The package names one for the
 * workspace and the member, then `chat` and `host`, beside the pool files, and
 * the member is not known here, so a file is one of these by its first part,
 * its last two and the one between being one whole part, which no pool file's
 * rest is.
 */
export function setupChatFiles(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
  tenant: string,
): readonly SetupFile[] {
  const prefix = `${setupPoolNamePart(tenant)}.`;
  return ports.disk
    .names(places.pools)
    .toSorted()
    .flatMap((name) => {
      if (!name.startsWith(prefix) || !name.endsWith(setupChatFileSuffix))
        return [];
      const member = name.slice(prefix.length, -setupChatFileSuffix.length);
      const path = setupPath(places.pools, name);
      return setupNamePart.test(member) && ports.disk.kind(path) === "File"
        ? [{ path }]
        : [];
    });
}

/** What of the chat host's file is read: the id the site holds that host by, which is not its secret. */
const setupChatFileSchema = z.object({ clientId: identitySchema });

/** The id the site holds the chat host of `file` by, or nothing where the file says none this program reads. */
export function setupChatClient(
  ports: SetupPorts,
  file: SetupFile,
): string | undefined {
  const parsed = setupChatFileSchema.safeParse(
    setupJson(ports.disk.text(file.path, setupTextBytesMax)),
  );
  return parsed.success ? parsed.data.clientId : undefined;
}

/** The kind of credential settings would run work on, a run writing a subscription's where there are none. */
function setupClaudeHere(
  settings: SetupSettingsRead,
): SetupClaudeKind | undefined {
  switch (settings.settings) {
    case "Absent":
      return "Subscription";
    case "Unread":
      return undefined;
    case "Read":
      return settings.credential.kind;
  }
}

/** Looks at the machine as `runner` would before it did anything, and changes nothing. */
export async function setupRunnerHere(
  ports: SetupPorts,
  partition: PartitionIdentity,
): Promise<SetupRunnerHere> {
  const places = setupRunnerPlaces(ports.surroundings);
  const settings = setupSettingsRead(ports, places);
  const room = await setupRunnerRoom(
    ports,
    settings.settings === "Read" ? settings : undefined,
  );
  const open = room.room === "Open";
  return {
    room,
    held: open && setupPoolFiles(ports, places, partition).length > 0,
    chat: open && setupChatFiles(ports, places, partition.tenant).length > 0,
    claude: setupClaudeHere(settings),
  };
}

/** The service of a registration's file, as the package names it and where it writes it: a systemd unit by its name, or a launchd agent by its label. */
export interface SetupUnit {
  readonly name: string;
  readonly path: string;
}

export function setupUnitOf(
  platform: SetupPlatform,
  places: SetupRunnerPlaces,
  file: SetupFile,
): SetupUnit {
  const base = file.path.slice(
    file.path.lastIndexOf("/") + 1,
    -setupPoolFileSuffix.length,
  );
  const program = runnerPackages[platform].program;
  if (platform === "darwin") {
    const name = `${program}.${base}`;
    return { name, path: setupPath(places.units, `${name}.plist`) };
  }
  const name = `${program}-${base}.service`;
  return { name, path: setupPath(places.units, name) };
}

/** A unit's text, or nothing where there is none or it cannot be read. */
export function setupUnitText(
  ports: SetupPorts,
  unit: SetupUnit,
): string | undefined {
  return ports.disk.text(unit.path, setupTextBytesMax);
}

/** The commands of the installed package and of the machine's service manager that `runner` runs. */
export const setupRunnerCommands = {
  check: (command: string, file: SetupFile): readonly string[] => [
    command,
    "doctor",
    "--pool",
    file.path,
  ],
  service: (
    platform: SetupPlatform,
    command: string,
    file: SetupFile,
  ): readonly string[] => [
    command,
    platform === "darwin" ? "install-agent" : "install-service",
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
  /** An agent unloaded, whose failure says only that it was not loaded. */
  unload: (domain: string, unit: SetupUnit): readonly string[] => [
    "launchctl",
    "bootout",
    `${domain}/${unit.name}`,
  ],
  load: (domain: string, unit: SetupUnit): readonly string[] => [
    "launchctl",
    "bootstrap",
    domain,
    unit.path,
  ],
  kick: (domain: string, unit: SetupUnit): readonly string[] => [
    "launchctl",
    "kickstart",
    "-k",
    `${domain}/${unit.name}`,
  ],
} as const;

/**
 * The launchd domain chuggy-darwin loads an agent into: the person's desktop
 * session's where launchd answers for one, and their background session's
 * otherwise, as `install-agent` chooses it.
 */
export async function setupAgentDomain(ports: SetupPorts): Promise<string> {
  const user = ports.surroundings.user ?? "";
  const desktop = await setupProbed(ports, [
    "launchctl",
    "print",
    `gui/${user}`,
  ]);
  return `${setupWell(desktop) ? "gui" : "user"}/${user}`;
}

/**
 * Whether an agent is loaded in `domain` and running, and the one word launchd
 * said of its state: empty where it is not loaded or said no word, and nothing
 * where launchctl could not be run.
 */
export async function setupAgentIs(
  ports: SetupPorts,
  domain: string,
  unit: SetupUnit,
): Promise<{
  readonly loaded: boolean;
  readonly is: boolean;
  readonly said: string | undefined;
}> {
  const ended = await setupProbed(ports, [
    "launchctl",
    "print",
    `${domain}/${unit.name}`,
  ]);
  if (ended.ended !== "Exited")
    return { loaded: false, is: false, said: undefined };
  if (!setupWell(ended)) return { loaded: false, is: false, said: "" };
  const said = /^\s*state = ([a-z-]+)$/mu.exec(ended.out)?.[1] ?? "";
  return { loaded: true, is: said === "running", said };
}

/** Where a machine's runner services are: on Linux, or on a Mac in the launchd domain they are loaded in. */
export type SetupServicesAt =
  | { readonly platform: "linux" }
  | { readonly platform: "darwin"; readonly domain: string };

/** Restarts every runner service of this machine's, each of which reads the runner's settings only as it starts: on a Mac, each agent by the label its file is named for. */
export function setupRestartAll(
  places: SetupRunnerPlaces,
  at: SetupServicesAt,
): string {
  const program = runnerPackages[at.platform].program;
  if (at.platform === "linux")
    return `systemctl --user restart '${program}-*.service'`;
  const agents = `'${places.units.replaceAll("'", "'\\''")}'/${program}.*.plist`;
  return `for agent in ${agents}; do launchctl kickstart -k ${at.domain}/"$(basename "$agent" .plist)"; done`;
}

/**
 * Whether a unit is what `verb` asks, and the one word the service manager said
 * of it: empty where what it said is no word, and nothing where it did not
 * answer. One that ends badly having printed nothing did not answer, which is
 * how it ends where it cannot reach the person's services.
 */
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
  if (!setupWell(ended) && said === "") return { is: false, said: undefined };
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
