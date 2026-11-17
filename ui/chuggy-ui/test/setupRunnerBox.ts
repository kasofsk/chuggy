/**
 * A Linux machine, or a Mac, as `runner` meets one, with nothing real in it: its paths
 * are a map, and each program the command runs is answered here as the real
 * one was found to answer, doing to the map and to the site what the real one
 * does.
 *
 * The runner package's own rules are written here a second time on purpose,
 * from the package and not from the program: how a pool file, the file of the
 * person's chat host and their units or agents are named, what `register`,
 * `doctor`, `install-service` and `install-agent` print, how launchd answers, and that a registration is a redemption at the
 * site. A case that moved one of them in
 * the program alone finds this box disagreeing with it. What a case wants to
 * go otherwise it names in `answers`, and the box then does nothing for that
 * act and answers as told.
 */

import { setupPluginId } from "../app/core/setupProgram.ts";
import { SetupMachineError } from "../app/core/setupPorts.ts";
import type { SetupChildEnded, SetupDiskPort } from "../app/core/setupPorts.ts";
import type { SetupEngine } from "../app/core/setupRunnerSaid.ts";
import {
  setupSiteChatRedeemed,
  setupSitePersonalId,
  setupSitePersonalRedeemed,
  setupSiteRedeemed,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

export const boxHome = "/home/person";
export const boxConfig = `${boxHome}/.config`;
export const boxSettings = `${boxConfig}/chuggy-linux/runner.json`;
export const boxLogin = `${boxConfig}/chuggy-linux/claude/token`;
export const boxPools = `${boxConfig}/chuggy/pools`;
export const boxUnits = `${boxConfig}/systemd/user`;
/** Where chuggy-darwin keeps a Mac's settings and login, and where its agents are. */
export const boxMacSupport = `${boxHome}/Library/Application Support/chuggy-darwin`;
export const boxMacSettings = `${boxMacSupport}/runner.json`;
export const boxMacLogin = `${boxMacSupport}/claude/token`;
export const boxAgents = `${boxHome}/Library/LaunchAgents`;
/** Where npm installs machine-wide on this machine, and the person's own prefix. */
export const boxPrefix = "/usr/local";
export const boxOwn = `${boxHome}/.local`;
/** The name `register` gives this machine's pool, which is its hostname's. */
export const boxPoolName = "shame";
/** What the Claude login file holds, which nothing may read or print. */
export const boxLoginSecret = "sk-ant-oat01-box-claude-login-never-read";
/** The folder the program and every command it runs are run in, and where Claude Code keeps the person's configuration. */
export const boxFolder = `${boxHome}/work`;
export const boxClaudeConfig = `${boxHome}/.claude.json`;
/** The memory the engine reports unless a case says another, in bytes: what a VM of twelve GiB reported in Colima, below its nominal size as engines report. */
export const boxEngineBytes = 12_562_779_340;

/** The version an install puts here unless a case has the release be another. */
export const boxVersion = "0.35.0";

/** The process every running service of the box's runs as. */
export const boxPid = 69807;

/** Everything the command runs on the machine, by what it is for. */
export type BoxAct =
  | "services"
  | "docker"
  | "podman"
  | "install"
  | "register"
  | "doctor"
  | "service"
  | "reload"
  | "enabled"
  | "active"
  | "shown"
  | "start"
  | "restart"
  | "linger"
  | "lingerOn"
  | "mcpAdd"
  | "mcpRemove"
  | "domain"
  | "agent"
  | "unload"
  | "load"
  | "kick"
  | "colimaStop"
  | "colimaStart";

/** A Mac's Colima VM, as `status`, `list`, `ssh` and its profile's settings show it. */
export interface BoxColimaVm {
  running: boolean;
  vmType: "vz" | "qemu";
  vzRosetta: boolean;
  /** The memory `status` and `list` say it has, in bytes, or nothing where they say none. */
  memoryBytes: number | undefined;
  arch: "aarch64" | "x86_64";
  /** Whether it runs amd64 programs through Rosetta, as its binfmt_misc shows. */
  rosettaOn: boolean;
}

/** A Mac: whether it is Apple silicon, whether Rosetta is installed, its memory in bytes, and Colima's profile with its VM where there is one. */
export interface BoxMac {
  silicon: boolean;
  rosetta: boolean;
  memoryBytes: number;
  readonly profile: string;
  vm: BoxColimaVm | undefined;
}

/** The acts that change the machine or the site, in the order a first run does them for the project's runner. */
export const boxActs = [
  "install",
  "register",
  "doctor",
  "service",
  "lingerOn",
  "reload",
  "start",
] as const satisfies readonly BoxAct[];

type BoxAnswer =
  SetupChildEnded | ((command: readonly string[]) => SetupChildEnded);

interface BoxUnit {
  enabled: boolean;
  active: boolean;
}

export interface RunnerBox {
  /** Every path outside the program's own directory: a file's text, or nothing for a directory. */
  readonly paths: Map<string, string | undefined>;
  /** The paths that are themselves symbolic links, each to the file `paths` holds for it. */
  readonly links: Set<string>;
  /** The directories this user may not write in, and the paths that will not be made. */
  readonly sealed: Set<string>;
  /** Every path whose text the program read. */
  readonly read: string[];
  /** Every command run to its end, in order, and which act each was. */
  readonly ran: (readonly string[])[];
  readonly acts: BoxAct[];
  /** What an act answers where a case says other than what the machine does, from the command where the case wants it; the machine then does nothing for it. */
  readonly answers: Map<BoxAct, BoxAnswer>;
  /** How long an act takes where a case has it take time; one waited on for less never ends. */
  readonly lasts: Map<BoxAct, number>;
  /** What happens once an act is done, where a case ends the run there. */
  after: (act: BoxAct) => void;
  /** What `npm prefix -g` prints, or nothing where npm does not answer. */
  prefix: string | undefined;
  /** What `claude plugin list --json` prints, which has chuggy's plugin installed and on unless a case says otherwise, or nothing where claude does not answer. */
  plugins: string | undefined;
  /** The version of the package's current release, which an install puts here. */
  release: string;
  engines: Record<SetupEngine, "Yes" | "No" | "Absent">;
  /** The memory every engine here reports in its `info`, in bytes, or nothing where it reports none. */
  memoryBytes: number | undefined;
  /** The containers running on every engine here, which none are unless a case says so. */
  containers: BoxContainer[];
  /** What `stats` prints: null for a line of each container's own use, and nothing where it fails. */
  stats: string | undefined | null;
  /** Whether the user's service manager answers. */
  services: boolean;
  /** What the login manager says of lingering, or nothing where it does not say; and whether turning it on wants a password. */
  linger: "yes" | "no" | undefined;
  lingerAsks: boolean;
  readonly units: Map<string, BoxUnit>;
  /** Whether a service that is started stays up, and whether one that is up polls, which is what the site sees as live. */
  stays: boolean;
  polls: boolean;
  /** How many looks at a service just started find it mid-spawn before it is running, and how many each started service has left. */
  spawns: number;
  readonly spawnsLeft: Map<string, number>;
  /** The status a service that does not stay up last exited with, or nothing where it has not exited. */
  exit: number | undefined;
  /** Whether launchd answers for the person's desktop session, which it does where they are logged in at the Mac's screen. */
  desktop: boolean;
  /** What `doctor` prints aside and exits with, where a case has it find something. */
  doctor: { readonly aside: string; readonly exit: number } | undefined;
  /** The Mac this is, where docker runs in Colima, or nothing where it is no such Mac. */
  mac: BoxMac | undefined;
}

/** A container running on the box's engine: its id and name, its labels, its memory cap in bytes, 0 for none, its use as `stats` prints it, and whether it has a restart policy, which is what starts it again with Colima's VM. */
export interface BoxContainer {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly memoryBytes: number;
  readonly usage: string;
  readonly restarts?: boolean;
}

export function exited(exit: number, out = "", err = ""): SetupChildEnded {
  return { ended: "Exited", exit, out, err };
}

export function runnerBox(): RunnerBox {
  return {
    paths: new Map<string, string | undefined>([
      [`${boxPrefix}/bin`, undefined],
      [`${boxPrefix}/lib/node_modules`, undefined],
      [boxLogin, boxLoginSecret],
    ]),
    links: new Set(),
    sealed: new Set(),
    read: [],
    ran: [],
    acts: [],
    answers: new Map(),
    lasts: new Map(),
    after: () => undefined,
    prefix: boxPrefix,
    plugins: JSON.stringify([
      {
        id: setupPluginId,
        version: "0.1.0",
        scope: "user",
        enabled: true,
        installPath: [boxHome, ".claude", "plugins", "chuggy"].join("/"),
      },
    ]),
    release: boxVersion,
    engines: { docker: "Yes", podman: "Absent" },
    memoryBytes: boxEngineBytes,
    containers: [],
    stats: null,
    services: true,
    linger: "no",
    lingerAsks: false,
    units: new Map(),
    stays: true,
    polls: true,
    spawns: 0,
    spawnsLeft: new Map(),
    exit: undefined,
    desktop: true,
    doctor: undefined,
    mac: undefined,
  };
}

function kind(box: RunnerBox, path: string): ReturnType<SetupDiskPort["kind"]> {
  if (box.paths.has(path))
    return box.paths.get(path) === undefined ? "Directory" : "File";
  return [...box.paths.keys()].some((held) => held.startsWith(`${path}/`))
    ? "Directory"
    : "None";
}

export function boxDisk(box: RunnerBox): SetupDiskPort {
  return {
    kind: (path) => kind(box, path),
    linked: (path) => box.links.has(path),
    names: (directory) => [
      ...new Set(
        [...box.paths.keys()]
          .filter((held) => held.startsWith(`${directory}/`))
          .map((held) => held.slice(directory.length + 1).split("/")[0] ?? ""),
      ),
    ],
    text: (path, bytesMax) => {
      box.read.push(path);
      const held = box.paths.get(path);
      return held === undefined || held.length > bytesMax ? undefined : held;
    },
    make: (path, text) => {
      if (box.sealed.has(path) || kind(box, path) !== "None")
        throw new SetupMachineError({ fault: "Unwritable", path });
      box.paths.set(path, text);
    },
    replace: (path, text) => {
      if (box.sealed.has(path) || kind(box, path) !== "File")
        throw new SetupMachineError({ fault: "Unwritable", path });
      box.paths.set(path, text);
    },
    writable: (directory) =>
      kind(box, directory) === "Directory" && !box.sealed.has(directory),
  };
}

/** One part of a pool file's name, as the package writes it. */
export function boxNamePart(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((octet) =>
      /[A-Za-z0-9-]/u.test(String.fromCharCode(octet))
        ? String.fromCharCode(octet)
        : `_${octet.toString(16).padStart(2, "0")}`,
    )
    .join("");
}

/** The pool file the package writes for a project on this machine, and the unit it writes for that file. */
export function boxPoolFile(tenant: string, project: string): string {
  return `${boxPools}/${boxNamePart(tenant)}.${boxNamePart(project)}.${boxPoolName}.json`;
}

export function boxUnitName(tenant: string, project: string): string {
  return `chuggy-linux-${boxNamePart(tenant)}.${boxNamePart(project)}.${boxPoolName}.service`;
}

/** The file the package writes for the person's own runner in a workspace, named for it and the member, and the unit it writes for that file. */
export function boxPersonalFile(tenant: string, member: string): string {
  return `${boxPools}/${boxNamePart(tenant)}.${boxNamePart(member)}.json`;
}

export function boxPersonalUnitName(tenant: string, member: string): string {
  return `chuggy-linux-${boxNamePart(tenant)}.${boxNamePart(member)}.service`;
}

/** The file the package writes for the person's chat host in a workspace, named for it and the member, and the unit it writes for that file. */
export function boxChatFile(tenant: string, member: string): string {
  return `${boxPools}/${boxNamePart(tenant)}.${boxNamePart(member)}.chat.host.json`;
}

export function boxChatUnitName(tenant: string, member: string): string {
  return `chuggy-linux-${boxNamePart(tenant)}.${boxNamePart(member)}.chat.host.service`;
}

/** The label chuggy-darwin gives the agent of a file: its name less `.json`, after the package's. */
export function boxAgentLabel(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  return `chuggy-darwin.${base}`;
}

/** The package a machine runs, where it keeps its settings and services, and the service it names for a file. */
interface BoxPackage {
  readonly program: "chuggy-linux" | "chuggy-darwin";
  readonly settings: string;
  readonly login: string;
  readonly units: string;
  readonly unitOf: (file: string) => string;
  readonly unitPath: (file: string) => string;
}

function boxPackageOf(platform: string): BoxPackage {
  if (platform === "darwin")
    return {
      program: "chuggy-darwin",
      settings: boxMacSettings,
      login: boxMacLogin,
      units: boxAgents,
      unitOf: boxAgentLabel,
      unitPath: (file) => `${boxAgents}/${boxAgentLabel(file)}.plist`,
    };
  const unitOf = (file: string) => {
    const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
    return `chuggy-linux-${base}.service`;
  };
  return {
    program: "chuggy-linux",
    settings: boxSettings,
    login: boxLogin,
    units: boxUnits,
    unitOf,
    unitPath: (file) => `${boxUnits}/${unitOf(file)}`,
  };
}

/** What each act is run as, by the words that tell them apart after the program's own name. */
const told: readonly (readonly [BoxAct, string, readonly string[]])[] = [
  ["services", "systemctl", ["show"]],
  ["reload", "systemctl", ["daemon-reload"]],
  ["enabled", "systemctl", ["is-enabled"]],
  ["active", "systemctl", ["is-active"]],
  ["start", "systemctl", ["enable", "--now"]],
  ["restart", "systemctl", ["restart"]],
  ["docker", "docker", ["version"]],
  ["podman", "podman", ["info", "--format", "{{.Host.Os}}"]],
  ["install", "npm", ["i", "-g"]],
  ["linger", "loginctl", ["show-user"]],
  ["lingerOn", "loginctl", ["--no-ask-password", "enable-linger"]],
  ["register", "chuggy-linux", ["register"]],
  ["doctor", "chuggy-linux", ["doctor"]],
  ["service", "chuggy-linux", ["install-service"]],
  ["register", "chuggy-darwin", ["register"]],
  ["doctor", "chuggy-darwin", ["doctor"]],
  ["service", "chuggy-darwin", ["install-agent"]],
  ["domain", "launchctl", ["print"]],
  ["unload", "launchctl", ["bootout"]],
  ["load", "launchctl", ["bootstrap"]],
  ["kick", "launchctl", ["kickstart", "-k"]],
  ["mcpAdd", "claude", ["mcp", "add", "--scope", "local"]],
  ["mcpRemove", "claude", ["mcp", "remove", "--scope", "local"]],
  ["colimaStop", "colima", ["stop"]],
  ["colimaStart", "colima", ["start"]],
];

export function boxActOf(command: readonly string[]): BoxAct | undefined {
  const [program = "", ...rest] = command;
  const name = program.slice(program.lastIndexOf("/") + 1);
  const words = rest.filter((word) => word !== "--user");
  const act = told.find(
    ([, runs, first]) =>
      runs === name && first.every((word, at) => words[at] === word),
  )?.[0];
  if (act === "services" && words[1] !== "--property") return "shown";
  return act === "domain" && (words[1] ?? "").split("/").length > 2
    ? "agent"
    : act;
}

/** The person's Claude Code configuration as the box holds it, or an empty one. */
function boxClaude(box: RunnerBox): {
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
} {
  const held = box.paths.get(boxClaudeConfig);
  return held === undefined
    ? {}
    : (JSON.parse(held) as ReturnType<typeof boxClaude>);
}

/** A server in the folder's local configuration, as Claude Code writes one, or none removed; a name already there is refused, as Claude Code refuses it. */
function boxServed(
  box: RunnerBox,
  command: readonly string[],
  added: boolean,
): SetupChildEnded {
  const name = command[5] ?? "";
  const config = boxClaude(box);
  const projects = config.projects ?? {};
  const servers = { ...projects[boxFolder]?.mcpServers };
  if (added === Object.hasOwn(servers, name))
    return exited(
      1,
      "",
      `MCP server ${name} ${added ? "already exists" : "not found"} in local config\n`,
    );
  if (added) {
    const [run = "", ...args] = command.slice(command.indexOf("--") + 1);
    servers[name] = { type: "stdio", command: run, args, env: {} };
  } else delete servers[name];
  box.paths.set(
    boxClaudeConfig,
    JSON.stringify({
      ...config,
      projects: { ...projects, [boxFolder]: { mcpServers: servers } },
    }),
  );
  return exited(0, `${added ? "Added" : "Removed"} MCP server ${name}\n`);
}

/** What an engine's `info` prints, as docker or podman lays it out, where it answers this user: the memory it has, which is all of it a run reads. */
export function boxEngineInfo(
  box: RunnerBox,
  command: readonly string[],
): string | undefined {
  const name = command[0] === "podman" ? "podman" : "docker";
  if (box.engines[name] !== "Yes" || box.memoryBytes === undefined)
    return undefined;
  return JSON.stringify(
    name === "podman"
      ? { host: { memTotal: box.memoryBytes, os: "linux" } }
      : {
          MemTotal: box.memoryBytes,
          NCPU: 4,
          ...(box.mac === undefined ? {} : { Name: boxColimaName(box.mac) }),
        },
  );
}

/** What an engine here prints of its running containers where it answers this user: their ids, an inspection of them as docker lays it out, or what each uses. */
export function boxEngineContainers(
  box: RunnerBox,
  command: readonly string[],
): string | undefined {
  const name = command[0] === "podman" ? "podman" : "docker";
  if (box.engines[name] !== "Yes") return undefined;
  const { containers } = box;
  if (command[1] === "ps")
    return containers.map(({ id }) => `${id}\n`).join("");
  if (command[1] === "container")
    return JSON.stringify(
      containers
        .filter(({ id }) => command.slice(3).includes(id))
        .map((container) => ({
          Name: `/${container.name}`,
          Config: { Labels: container.labels },
          HostConfig: { Memory: container.memoryBytes },
        })),
    );
  return box.stats === null
    ? containers
        .map(({ name: named, usage }) => `${named} ${usage} / 11.7GiB\n`)
        .join("")
    : box.stats;
}

/** The name docker's info gives Colima's VM, and its context's. */
function boxColimaName(mac: BoxMac): string {
  return mac.profile === "default" ? "colima" : `colima-${mac.profile}`;
}

/** The profile a Colima command names, which is the default where it names none. */
function boxColimaProfile(command: readonly string[]): string {
  const at = command.indexOf("--profile");
  return at < 0 ? "default" : (command[at + 1] ?? "");
}

/** Where the box keeps a Colima profile's settings. */
export function boxColimaYaml(profile: string): string {
  return `${boxHome}/.colima/${profile}/colima.yaml`;
}

/** The settings Colima writes for a VM, of which a run reads only its type and Rosetta. */
function boxColimaSettings(vm: BoxColimaVm): string {
  return `cpu: 2\nmemory: 2\nvmType: ${vm.vmType}\nvzRosetta: ${String(vm.vzRosetta)}\n`;
}

/** What a Mac answers of a read of itself or its Colima, or nothing where the read is not one; a box that is no such Mac answers none of them. */
export function boxMacRead(
  box: RunnerBox,
  command: readonly string[],
): string | undefined {
  const { mac } = box;
  const said = command.join(" ");
  if (said === "arch -x86_64 /usr/bin/true")
    return mac?.rosetta === true ? "" : undefined;
  if (said === "sysctl -n hw.optional.arm64")
    return mac === undefined ? undefined : mac.silicon ? "1\n" : "0\n";
  if (said === "sysctl -n hw.memsize")
    return mac === undefined ? undefined : `${String(mac.memoryBytes)}\n`;
  if (said === "docker context show")
    return mac === undefined ? undefined : `${boxColimaName(mac)}\n`;
  if (mac === undefined || command[0] !== "colima") return undefined;
  if (boxColimaProfile(command) !== mac.profile) return undefined;
  const { vm } = mac;
  switch (command[1] ?? "") {
    case "status":
      return vm?.running === true
        ? JSON.stringify({
            display_name: boxColimaName(mac),
            driver:
              vm.vmType === "vz" ? "macOS Virtualization.Framework" : "QEMU",
            arch: vm.arch,
            cpu: 2,
            ...(vm.memoryBytes === undefined ? {} : { memory: vm.memoryBytes }),
          })
        : undefined;
    case "list":
      return vm === undefined
        ? ""
        : `${JSON.stringify({
            name: mac.profile,
            status: vm.running ? "Running" : "Stopped",
            arch: vm.arch,
            cpus: 2,
            ...(vm.memoryBytes === undefined ? {} : { memory: vm.memoryBytes }),
          })}\n`;
    case "ssh":
      if (vm?.running !== true) return undefined;
      if (command.at(-1) === "/proc/sys/fs/binfmt_misc")
        return vm.rosettaOn
          ? "register\nrosetta\nstatus\n"
          : "register\nstatus\n";
      return vm.rosettaOn
        ? "enabled\ninterpreter /mnt/lima-rosetta/rosetta\n"
        : undefined;
    default:
      return undefined;
  }
}

/** Colima's VM stopped, which stops docker with it. */
function boxColimaStopped(box: RunnerBox): SetupChildEnded {
  const vm = box.mac?.vm;
  if (vm === undefined) return exited(1, "", "colima is not running\n");
  vm.running = false;
  box.engines.docker = "No";
  box.containers = box.containers.filter(({ restarts }) => restarts === true);
  return exited(0);
}

/** Colima's VM started, made where there is none, with what the command's flags change of it, as Colima keeps what it has unless a flag says otherwise. */
function boxColimaStarted(
  box: RunnerBox,
  command: readonly string[],
): SetupChildEnded {
  const { mac } = box;
  if (mac === undefined) return { ended: "Unstarted" };
  const memory = command.indexOf("--memory");
  const gib = memory < 0 ? undefined : Number(command[memory + 1]);
  const type = command.indexOf("--vm-type");
  const vm: BoxColimaVm = mac.vm ?? {
    running: false,
    vmType: command[type + 1] === "qemu" ? "qemu" : "vz",
    vzRosetta: false,
    memoryBytes: 2 * 2 ** 30,
    arch: "aarch64",
    rosettaOn: false,
  };
  if (gib !== undefined) vm.memoryBytes = gib * 2 ** 30;
  if (command.includes("--vz-rosetta")) vm.vzRosetta = true;
  vm.rosettaOn =
    vm.vmType === "vz" && vm.vzRosetta && mac.silicon && mac.rosetta;
  vm.running = true;
  mac.vm = vm;
  box.paths.set(boxColimaYaml(mac.profile), boxColimaSettings(vm));
  box.engines.docker = "Yes";
  box.memoryBytes = vm.memoryBytes;
  return exited(0);
}

/** The box made a Mac whose docker runs in Colima's VM `vm` of the profile `profile`, with what the box's engine reports being the VM's. */
export function boxMacMade(
  box: RunnerBox,
  mac: Omit<BoxMac, "vm" | "profile"> & {
    readonly profile?: string;
    readonly vm: BoxColimaVm | undefined;
  },
): void {
  const made: BoxMac = { profile: "default", ...mac };
  box.mac = made;
  const { vm } = made;
  if (vm !== undefined)
    box.paths.set(boxColimaYaml(made.profile), boxColimaSettings(vm));
  box.engines.docker = vm?.running === true ? "Yes" : "No";
  box.memoryBytes = vm?.memoryBytes;
}

/** Installs the package the command's last word names, chuggy-darwin's or chuggy-linux's, at the box's release. */
function installed(box: RunnerBox, command: readonly string[]): void {
  const at = command.indexOf("--prefix");
  const prefix = at < 0 ? (box.prefix ?? "") : (command[at + 1] ?? "");
  const program = (command.at(-1) ?? "").includes("chuggy-darwin")
    ? "chuggy-darwin"
    : "chuggy-linux";
  box.paths.set(`${prefix}/bin/${program}`, "#!/usr/bin/env node");
  box.paths.set(
    `${prefix}/lib/node_modules/${program}/package.json`,
    JSON.stringify({ name: program, version: box.release }),
  );
}

/** The box as `mcp` leaves it for `at`: the runner package `program` installed machine-wide, and its server named in the folder's local configuration in place of any of the same name. */
export function boxServing(
  box: RunnerBox,
  at: {
    readonly site: string;
    readonly workspace: string;
    readonly project: string;
  },
  program: "chuggy-linux" | "chuggy-darwin" = "chuggy-linux",
): void {
  installed(box, ["npm", "install", "--global", program]);
  boxServed(
    box,
    ["claude", "mcp", "remove", "--scope", "local", "chuggy"],
    false,
  );
  boxServed(
    box,
    [
      "claude",
      "mcp",
      "add",
      "--scope",
      "local",
      "chuggy",
      "--",
      `${boxPrefix}/bin/${program}`,
      "mcp",
      "--site",
      at.site,
      "--workspace",
      at.workspace,
      "--project",
      at.project,
    ],
    true,
  );
}

/** Whether the package a command is run from is new enough to know `--personal`, or `--chat` where `chat`, as its manifest says. */
function boxTakes(box: RunnerBox, program: string, chat: boolean): boolean {
  const name = program.slice(program.lastIndexOf("/") + 1);
  const prefix = program.slice(0, -`/bin/${name}`.length);
  const manifest = box.paths.get(
    `${prefix}/lib/node_modules/${name}/package.json`,
  );
  const version = /"version":"(\d+)\.(\d+)\./u.exec(manifest ?? "");
  const least = name === "chuggy-darwin" ? 23 : chat ? 35 : 4;
  return Number(version?.[1] ?? 0) > 0 || Number(version?.[2] ?? 0) >= least;
}

interface BoxWorld {
  readonly site: () => SetupSite;
  readonly origin: string;
  /** The platform the machine is, which names the package that runs on it. */
  readonly platform: string;
}

/** A registration, as a pool's, with `--personal` as the person's own runner, or with `--chat` as their chat host: the token redeemed at the site, and the file the package names for what it answered. */
function registered(
  box: RunnerBox,
  world: BoxWorld,
  command: readonly string[],
): SetupChildEnded {
  const [program = "", , ...said] = command;
  const personal = said[0] === "--personal";
  const words = personal ? said.slice(1) : said;
  const chat = words.at(-1) === "--chat";
  const option = personal ? "--personal" : "--chat";
  if ((chat || personal) && !boxTakes(box, program, chat))
    return exited(1, "", `error: unknown option '${option}'\n`);
  const [flag, api, token = ""] = chat ? words.slice(0, -1) : words;
  if (flag !== "--api" || api !== world.origin || !token.startsWith("--token="))
    return exited(2, "", "register needs --api and --token\n");
  const redeemed = token.slice("--token=".length);
  const answer = chat
    ? setupSiteChatRedeemed(world.site(), redeemed)
    : personal
      ? setupSitePersonalRedeemed(world.site(), redeemed)
      : setupSiteRedeemed(world.site(), redeemed, boxPoolName);
  if (answer.status !== 201)
    return exited(
      1,
      "",
      "the registration token is unknown, spent or expired; mint another in chuggy's console\n",
    );
  const held = answer.body as {
    tenant: string;
    project?: string;
    owner?: string;
  };
  const file = chat
    ? boxChatFile(held.tenant, held.owner ?? "")
    : personal
      ? boxPersonalFile(held.tenant, held.owner ?? "")
      : boxPoolFile(held.tenant, held.project ?? "");
  const at = boxPackageOf(world.platform);
  const unit = at.unitOf(file);
  const serves = box.paths.has(at.unitPath(file));
  const wrote = box.paths.has(file) ? "replaced" : "wrote";
  box.paths.set(file, JSON.stringify(answer.body));
  if (at.program === "chuggy-darwin")
    return exited(
      0,
      serves
        ? `${wrote} ${file}; chuggy denies the pool's earlier registration, so its agent stops until it is restarted:\n  launchctl kickstart -k ${boxDomain(box)}/${unit}\n`
        : `${wrote} ${file}; next:\n  chuggy-darwin doctor --pool ${file}\n  chuggy-darwin install-agent --pool ${file}\n`,
    );
  return exited(
    0,
    serves
      ? `${wrote} ${file}; chuggy denies the pool's earlier registration, so its service stops until it is restarted:\n  systemctl --user restart ${unit}\n`
      : `wrote ${file}; next:\n  chuggy-linux doctor --pool ${file}\n  chuggy-linux install-service --pool ${file}\n`,
  );
}

/** What `doctor` prints of a pool's file, or of a chat host's, which it checks for what the chat host runs too. */
function checks(at: BoxPackage, file: string): readonly string[] {
  const pool = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  const ok = [
    `ok    pool file: ${file} names pool ${pool.replaceAll(".", "/")}`,
    `ok    runner configuration: ${at.settings}: concurrencyMax 1, sessionsMax 2`,
    at.program === "chuggy-darwin"
      ? "ok    Colima: docker answers from the colima context"
      : "ok    runtime directory: /run/user/1000/chuggy-linux",
    `ok    Claude credential: Subscription, from the Claude token file ${at.login}, this runner's own`,
    "ok    container engine: docker at unix:///var/run/docker.sock lists 0 of this pool's containers",
    "ok    job network: chuggy-jobs is missing, and a run makes it",
    "ok    pool token: issued by https://auth.example/oauth2/token",
    "ok    plane: https://pool.chuggy.example/ answered a poll",
  ];
  return file.endsWith(".chat.host.json")
    ? [
        ...ok,
        `ok    chat credential directory: ${at.login} is alone in its directory, which the chat supervisor is given read-only`,
        "ok    chat settings: sessionsMax 4, sessionMemoryMib 2048, idleSecs 600",
        "ok    chat supervisor: none is running",
        "ok    chat image: ghcr.io/kasofsk/chuggy-chat is here",
      ]
    : ok;
}

function checked(
  box: RunnerBox,
  at: BoxPackage,
  file: string,
): SetupChildEnded {
  const ok = checks(at, file);
  if (!box.paths.has(at.settings))
    return exited(
      1,
      `${ok[0] ?? ""}\n`,
      `FAIL  runner configuration: ${at.settings} is missing\n`,
    );
  return box.doctor === undefined
    ? exited(0, `${ok.join("\n")}\n`)
    : exited(box.doctor.exit, `${ok[0] ?? ""}\n`, box.doctor.aside);
}

/** The unit `install-service` writes for a file: run by the copy of the package the command is, so a unit two copies write differs. */
export function boxUnitText(program: string, file: string): string {
  const copy = program.slice(0, -"/bin/chuggy-linux".length);
  return `[Service]\nExecStart=/usr/bin/node ${copy}/lib/node_modules/chuggy-linux/cli.mjs run --pool ${file}\n`;
}

/** The service of a file written over any unit of its name that serves the same file, and a unit that serves another, or whose `ExecStart` cannot be read back, refused. */
function served(
  box: RunnerBox,
  program: string,
  file: string,
): SetupChildEnded {
  const unit = boxPackageOf("linux").unitOf(file);
  const path = `${boxUnits}/${unit}`;
  if (box.paths.has(path)) {
    const serves = /^ExecStart=.* --pool (\S+)$/mu.exec(
      box.paths.get(path) ?? "",
    )?.[1];
    if (serves !== file)
      return exited(
        1,
        "",
        serves === undefined
          ? `${path} has no ExecStart chuggy-linux wrote; remove it if it is stale\n`
          : `${path} serves ${serves}, not ${file}; remove it if it is stale\n`,
      );
  }
  box.paths.set(path, boxUnitText(program, file));
  return exited(
    0,
    `wrote ${path}; start it with:\n  systemctl --user daemon-reload\n  systemctl --user enable --now ${unit}\n  loginctl enable-linger\n`,
  );
}

/** The agent `install-agent` writes for a file, which runs the copy of the package the command is. */
export function boxAgentText(program: string, file: string): string {
  const copy = program.slice(0, -"/bin/chuggy-darwin".length);
  return `<plist><dict><key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>${copy}/lib/node_modules/chuggy-darwin/cli.mjs</string><string>run</string><string>--pool</string><string>${file}</string></array></dict></plist>\n`;
}

/** The agent of a file written over any of its label that serves the same file, and one that serves another refused, as chuggy-darwin refuses it. */
function agentServed(
  box: RunnerBox,
  program: string,
  file: string,
): SetupChildEnded {
  const label = boxAgentLabel(file);
  const path = `${boxAgents}/${label}.plist`;
  const serves = /<string>--pool<\/string><string>([^<]*)<\/string>/u.exec(
    box.paths.get(path) ?? "",
  )?.[1];
  if (box.paths.has(path) && serves !== file)
    return exited(
      1,
      "",
      `${path} serves ${serves ?? "no pool file this runner named"}, not ${file}; remove that agent if it is stale, or rename the pool file\n`,
    );
  box.paths.set(path, boxAgentText(program, file));
  const domain = boxDomain(box);
  return exited(
    0,
    `wrote ${path}; start it, and Colima at login, with:\n  launchctl bootout ${domain}/${label}\n  launchctl bootstrap ${domain} ${path}\n  brew services start colima\n`,
  );
}

/** What the site sees once the unit `name` is up and polls: a runner of every project this machine is registered for as live, or, for the unit of the person's own runner or chat host, that runner or host where its file names it. */
function polled(box: RunnerBox, world: BoxWorld, name: string): void {
  const site = world.site();
  for (const [tenant, host] of site.chat) {
    const file = boxChatFile(tenant, site.member);
    if (
      name !== boxChatUnitName(tenant, site.member) &&
      name !== boxAgentLabel(file)
    )
      continue;
    const held = box.paths.get(file) ?? "{}";
    const { clientId } = JSON.parse(held) as { readonly clientId?: string };
    if (host.id === clientId) host.live = true;
  }
  for (const [tenant, held] of site.personal) {
    const file = boxPersonalFile(tenant, site.member);
    if (
      name !== boxPersonalUnitName(tenant, site.member) &&
      name !== boxAgentLabel(file)
    )
      continue;
    const { clientId } = JSON.parse(box.paths.get(file) ?? "{}") as {
      readonly clientId?: string;
    };
    const at = held.live.findIndex(
      (_, index) => setupSitePersonalId(index) === clientId,
    );
    if (at >= 0) held.live[at] = true;
  }
  if (
    !name.endsWith(`.${boxPoolName}.service`) &&
    !name.endsWith(`.${boxPoolName}`)
  )
    return;
  for (const project of site.projects)
    if (project.pools.includes(boxPoolName)) project.runner = "Live";
}

function up(
  box: RunnerBox,
  world: BoxWorld,
  name: string,
  enable: boolean,
  path = `${boxUnits}/${name}`,
) {
  if (!box.paths.has(path))
    return exited(
      1,
      "",
      `Failed to enable unit: Unit file ${name} does not exist.\n`,
    );
  const unit = box.units.get(name) ?? { enabled: false, active: false };
  box.units.set(name, unit);
  unit.enabled ||= enable;
  unit.active = box.stays;
  box.spawnsLeft.set(name, box.spawns);
  if (unit.active && box.polls) polled(box, world, name);
  return exited(0);
}

function unitSaid(
  box: RunnerBox,
  name: string,
  asks: "enabled" | "active",
): SetupChildEnded {
  const is = box.units.get(name)?.[asks] === true;
  if (asks === "enabled")
    return exited(is ? 0 : 1, is ? "enabled\n" : "disabled\n");
  return exited(is ? 0 : 3, is ? "active\n" : "inactive\n");
}

/** Whether a look at a running service finds it mid-spawn, which spends one of the looks it has left. */
function spawning(box: RunnerBox, name: string): boolean {
  const left = box.spawnsLeft.get(name) ?? 0;
  if (left > 0) box.spawnsLeft.set(name, left - 1);
  return left > 0;
}

/**
 * How systemd shows a unit's state, its main process and the status that
 * last exited with: a unit running, mid-spawn, waiting to be started again
 * after an exit, or dead after one it does not restart or before any.
 */
function unitShown(box: RunnerBox, name: string): SetupChildEnded {
  const unit = box.units.get(name);
  const shown = (active: string, sub: string, pid: number, exit: number) =>
    exited(
      0,
      `ActiveState=${active}\nSubState=${sub}\nMainPID=${String(pid)}\nExecMainStatus=${String(exit)}\n`,
    );
  if (unit?.active === true)
    return spawning(box, name)
      ? shown("activating", "start", 0, 0)
      : shown("active", "running", boxPid, 0);
  if (box.exit === undefined || box.exit === 3)
    return shown("inactive", "dead", 0, box.exit ?? 0);
  return shown("activating", "auto-restart", 0, box.exit);
}

/** What `launchctl print` says of a loaded agent's own state, pid and last exit, beside a nested section's state, which is not the agent's. */
function agentPrinted(
  box: RunnerBox,
  target: string,
  label: string,
  active: boolean,
): SetupChildEnded {
  const state = !active
    ? "not running"
    : spawning(box, label)
      ? "spawn scheduled"
      : "running";
  const lines = [
    `${target} = {`,
    `\tactive count = ${active ? 1 : 0}`,
    `\tpath = ${boxAgents}/${label}.plist`,
    `\tstate = ${state}`,
    ...(state === "running" ? [`\tpid = ${String(boxPid)}`] : []),
    `\tlast exit code = ${box.exit === undefined ? "(never exited)" : `${String(box.exit)}: ${box.exit === 75 ? "EX_TEMPFAIL" : "Undefined error"}`}`,
    "\tendpoints = {",
    "\t\tstate = active",
    "\t}",
    "}",
  ];
  return exited(0, `${lines.join("\n")}\n`);
}

/** The domain launchd answers for this user: the desktop session's where they are logged in at the screen, and the background one always. */
function boxDomain(box: RunnerBox): string {
  return box.desktop ? "gui/1000" : "user/1000";
}

/** How launchd answers a `print`, a `bootout`, a `bootstrap` or a `kickstart`: an agent known by its label in the one domain this user's agents load into, `units` holding it as loaded where it is enabled. */
function launchd(
  box: RunnerBox,
  world: BoxWorld,
  act: "domain" | "agent" | "unload" | "load" | "kick",
  command: readonly string[],
): SetupChildEnded {
  const target = command.at(-1) ?? "";
  if (act === "domain")
    return target === boxDomain(box)
      ? exited(
          0,
          `${target} = {\n\ttype = ${box.desktop ? "login" : "background"}\n}\n`,
        )
      : exited(
          113,
          "",
          "Bad request.\nCould not find domain for port identifier.\n",
        );
  if (act === "load") {
    const domain = command.at(-2) ?? "";
    const label = target.slice(target.lastIndexOf("/") + 1, -".plist".length);
    const unit = box.units.get(label);
    if (domain !== boxDomain(box) || !box.paths.has(target))
      return exited(5, "", "Bootstrap failed: 5: Input/output error\n");
    if (unit?.enabled === true)
      return exited(5, "", "Bootstrap failed: 17: File exists\n");
    return up(box, world, label, true, `${boxAgents}/${label}.plist`);
  }
  const at = target.lastIndexOf("/");
  const [domain, label] = [target.slice(0, at), target.slice(at + 1)];
  const unit = box.units.get(label);
  if (domain !== boxDomain(box) || unit?.enabled !== true)
    return act === "unload"
      ? exited(3, "", "Boot-out failed: 3: No such process\n")
      : exited(
          113,
          "",
          `Could not find service "${label}" in domain for user gui: 1000\n`,
        );
  switch (act) {
    case "agent":
      return agentPrinted(box, target, label, unit.active);
    case "unload":
      unit.enabled = false;
      unit.active = false;
      return exited(0);
    case "kick":
      return up(box, world, label, false, `${boxAgents}/${label}.plist`);
  }
}

function engine(box: RunnerBox, name: SetupEngine): SetupChildEnded {
  switch (box.engines[name]) {
    case "Yes":
      return exited(0, "27.3.1\n");
    case "No":
      return exited(
        1,
        "",
        "permission denied while trying to connect to the Docker daemon socket\n",
      );
    case "Absent":
      return { ended: "Unstarted" };
  }
}

function lingered(box: RunnerBox): SetupChildEnded {
  if (box.lingerAsks)
    return exited(
      1,
      "",
      "Could not enable linger: Interactive authentication required.\n",
    );
  box.linger = "yes";
  return exited(0);
}

function done(
  box: RunnerBox,
  world: BoxWorld,
  act: BoxAct,
  command: readonly string[],
): SetupChildEnded {
  const last = command.at(-1) ?? "";
  switch (act) {
    case "services":
      return box.services
        ? exited(0, "Version=255.4-1ubuntu8\n")
        : exited(1, "", "Failed to connect to bus: No medium found\n");
    case "docker":
    case "podman":
      return engine(box, act);
    case "install":
      installed(box, command);
      return exited(0, "\nadded 12 packages in 3s\n");
    case "register":
      return registered(box, world, command);
    case "doctor":
      return checked(box, boxPackageOf(world.platform), last);
    case "service":
      return world.platform === "darwin"
        ? agentServed(box, command[0] ?? "", last)
        : served(box, command[0] ?? "", last);
    case "colimaStop":
      return boxColimaStopped(box);
    case "colimaStart":
      return boxColimaStarted(box, command);
    case "reload":
      return exited(0);
    case "enabled":
    case "active":
      return unitSaid(box, last, act);
    case "shown":
      return unitShown(box, command.at(-2) ?? "");
    case "start":
      return up(box, world, last, true);
    case "restart":
      return up(box, world, last, false);
    case "linger":
      return box.linger === undefined
        ? exited(1, "", "Failed to get user: No such process\n")
        : exited(0, `Linger=${box.linger}\n`);
    case "lingerOn":
      return lingered(box);
    case "mcpAdd":
      return boxServed(box, command, true);
    case "mcpRemove":
      return boxServed(box, command, false);
    case "domain":
    case "agent":
    case "unload":
    case "load":
    case "kick":
      return launchd(box, world, act, command);
  }
}

/** Runs one command on the box: one it does not know, or one of the package's that is not installed where it was run from, did not start. */
export function boxRan(
  box: RunnerBox,
  world: BoxWorld,
  command: readonly string[],
  waitMs: number,
): SetupChildEnded {
  box.ran.push(command);
  const act = boxActOf(command);
  const program = command[0] ?? "";
  if (act === undefined || (program.includes("/") && !box.paths.has(program)))
    return { ended: "Unstarted" };
  box.acts.push(act);
  if ((box.lasts.get(act) ?? 0) > waitMs) return { ended: "Unended" };
  const told = box.answers.get(act);
  if (told !== undefined)
    return typeof told === "function" ? told(command) : told;
  const ended = done(box, world, act, command);
  box.after(act);
  return ended;
}
