/**
 * A Linux machine as `runner` meets one, with nothing real in it: its paths
 * are a map, and each program the command runs is answered here as the real
 * one was found to answer, doing to the map and to the site what the real one
 * does.
 *
 * The runner package's own rules are written here a second time on purpose,
 * from the package and not from the program: how a pool file and its unit are
 * named, what `register`, `doctor` and `install-service` print, and that a
 * registration is a redemption at the site. A case that moved one of them in
 * the program alone finds this box disagreeing with it. What a case wants to
 * go otherwise it names in `answers`, and the box then does nothing for that
 * act and answers as told.
 */

import { SetupMachineError } from "../app/core/setupPorts.ts";
import type { SetupChildEnded, SetupDiskPort } from "../app/core/setupPorts.ts";
import type { SetupEngine } from "../app/core/setupRunnerSaid.ts";
import { setupSiteRedeemed } from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

export const boxHome = "/home/person";
export const boxConfig = `${boxHome}/.config`;
export const boxSettings = `${boxConfig}/chuggy-linux/runner.json`;
export const boxLogin = `${boxConfig}/chuggy-linux/claude-token`;
export const boxPools = `${boxConfig}/chuggy/pools`;
export const boxUnits = `${boxConfig}/systemd/user`;
/** Where npm installs machine-wide on this machine, and the person's own prefix. */
export const boxPrefix = "/usr/local";
export const boxOwn = `${boxHome}/.local`;
/** The name `register` gives this machine's pool, which is its hostname's. */
export const boxPoolName = "shame";
/** What the Claude login file holds, which nothing may read or print. */
export const boxLoginSecret = "sk-ant-oat01-box-claude-login-never-read";
export const boxVersion = "0.3.0";

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
  | "start"
  | "restart"
  | "linger"
  | "lingerOn";

/** The acts that change the machine or the site, in the order a first run does them. */
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
  /** The directories this user may not write in, and the paths that will not be made. */
  readonly sealed: Set<string>;
  /** Every path whose text the program read. */
  readonly read: string[];
  /** Every command run to its end, in order, and which act each was. */
  readonly ran: (readonly string[])[];
  readonly acts: BoxAct[];
  /** What an act answers where a case says other than what the machine does, from the command where the case wants it; the machine then does nothing for it. */
  readonly answers: Map<BoxAct, BoxAnswer>;
  /** What happens once an act is done, where a case ends the run there. */
  after: (act: BoxAct) => void;
  /** What `npm prefix -g` prints, or nothing where npm does not answer. */
  prefix: string | undefined;
  engines: Record<SetupEngine, "Yes" | "No" | "Absent">;
  /** Whether the user's service manager answers. */
  services: boolean;
  /** What the login manager says of lingering, or nothing where it does not say; and whether turning it on wants a password. */
  linger: "yes" | "no" | undefined;
  lingerAsks: boolean;
  readonly units: Map<string, BoxUnit>;
  /** Whether a service that is started stays up, and whether one that is up polls, which is what the site sees as live. */
  stays: boolean;
  polls: boolean;
  /** What `doctor` prints aside and exits with, where a case has it find something. */
  doctor: { readonly aside: string; readonly exit: number } | undefined;
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
    sealed: new Set(),
    read: [],
    ran: [],
    acts: [],
    answers: new Map(),
    after: () => undefined,
    prefix: boxPrefix,
    engines: { docker: "Yes", podman: "Absent" },
    services: true,
    linger: "no",
    lingerAsks: false,
    units: new Map(),
    stays: true,
    polls: true,
    doctor: undefined,
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
    writable: (directory) =>
      kind(box, directory) === "Directory" && !box.sealed.has(directory),
  };
}

/** One part of a pool file's name, as the package writes it. */
function part(text: string): string {
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
  return `${boxPools}/${part(tenant)}.${part(project)}.${boxPoolName}.json`;
}

export function boxUnitName(tenant: string, project: string): string {
  return `chuggy-linux-${part(tenant)}.${part(project)}.${boxPoolName}.service`;
}

function unitOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  return `chuggy-linux-${base}.service`;
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
  ["podman", "podman", ["info"]],
  ["install", "npm", ["i", "-g"]],
  ["linger", "loginctl", ["show-user"]],
  ["lingerOn", "loginctl", ["--no-ask-password", "enable-linger"]],
  ["register", "chuggy-linux", ["register"]],
  ["doctor", "chuggy-linux", ["doctor"]],
  ["service", "chuggy-linux", ["install-service"]],
];

export function boxActOf(command: readonly string[]): BoxAct | undefined {
  const [program = "", ...rest] = command;
  const name = program.slice(program.lastIndexOf("/") + 1);
  const words = rest.filter((word) => word !== "--user");
  return told.find(
    ([, runs, first]) =>
      runs === name && first.every((word, at) => words[at] === word),
  )?.[0];
}

function installed(box: RunnerBox, command: readonly string[]): void {
  const at = command.indexOf("--prefix");
  const prefix = at < 0 ? (box.prefix ?? "") : (command[at + 1] ?? "");
  box.paths.set(`${prefix}/bin/chuggy-linux`, "#!/usr/bin/env node");
  box.paths.set(
    `${prefix}/lib/node_modules/chuggy-linux/package.json`,
    JSON.stringify({ name: "chuggy-linux", version: boxVersion }),
  );
}

interface BoxWorld {
  readonly site: () => SetupSite;
  readonly origin: string;
}

function registered(
  box: RunnerBox,
  world: BoxWorld,
  command: readonly string[],
): SetupChildEnded {
  const [, , flag, api, token = ""] = command;
  if (flag !== "--api" || api !== world.origin || !token.startsWith("--token="))
    return exited(2, "", "register needs --api and --token\n");
  const answer = setupSiteRedeemed(
    world.site(),
    token.slice("--token=".length),
    boxPoolName,
  );
  if (answer.status !== 201)
    return exited(
      1,
      "",
      "the registration token is unknown, spent or expired; mint another in chuggy's console\n",
    );
  const pool = answer.body as { tenant: string; project: string };
  const file = boxPoolFile(pool.tenant, pool.project);
  const unit = unitOf(file);
  const serves = box.paths.has(`${boxUnits}/${unit}`);
  const wrote = box.paths.has(file) ? "replaced" : "wrote";
  box.paths.set(file, JSON.stringify(answer.body));
  return exited(
    0,
    serves
      ? `${wrote} ${file}; chuggy denies the pool's earlier registration, so its service stops until it is restarted:\n  systemctl --user restart ${unit}\n`
      : `wrote ${file}; next:\n  chuggy-linux doctor --pool ${file}\n  chuggy-linux install-service --pool ${file}\n`,
  );
}

function checked(box: RunnerBox, file: string): SetupChildEnded {
  const pool = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  const ok = [
    `ok    pool file: ${file} names pool ${pool.replaceAll(".", "/")}`,
    `ok    runner configuration: ${boxSettings}: concurrencyMax 1, sessionsMax 2`,
    "ok    runtime directory: /run/user/1000/chuggy-linux",
    `ok    Claude token file: ${boxLogin}, this runner's own`,
    "ok    container engine: docker at unix:///var/run/docker.sock lists 0 of this pool's containers",
    "ok    job network: chuggy-jobs is missing, and a run makes it",
    "ok    pool token: issued by https://auth.example/oauth2/token",
    "ok    plane: https://pool.chuggy.example/ answered a poll",
  ];
  if (!box.paths.has(boxSettings))
    return exited(
      1,
      `${ok[0] ?? ""}\n`,
      `FAIL  runner configuration: ${boxSettings} is missing\n`,
    );
  return box.doctor === undefined
    ? exited(0, `${ok.join("\n")}\n`)
    : exited(box.doctor.exit, `${ok[0] ?? ""}\n`, box.doctor.aside);
}

function served(box: RunnerBox, file: string): SetupChildEnded {
  const unit = unitOf(file);
  box.paths.set(`${boxUnits}/${unit}`, `[Service]\nExecStart=run ${file}\n`);
  return exited(
    0,
    `wrote ${boxUnits}/${unit}; start it with:\n  systemctl --user daemon-reload\n  systemctl --user enable --now ${unit}\n  loginctl enable-linger\n`,
  );
}

/** A service that came up polls, which is when the site sees a runner of every project this machine is registered for as live. */
function up(box: RunnerBox, world: BoxWorld, name: string, enable: boolean) {
  if (!box.paths.has(`${boxUnits}/${name}`))
    return exited(
      1,
      "",
      `Failed to enable unit: Unit file ${name} does not exist.\n`,
    );
  const unit = box.units.get(name) ?? { enabled: false, active: false };
  box.units.set(name, unit);
  unit.enabled ||= enable;
  unit.active = box.stays;
  if (unit.active && box.polls)
    for (const project of world.site().projects)
      if (project.pools.includes(boxPoolName)) project.runner = "Live";
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
      return checked(box, last);
    case "service":
      return served(box, last);
    case "reload":
      return exited(0);
    case "enabled":
    case "active":
      return unitSaid(box, last, act);
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
  }
}

/** Runs one command on the box: one it does not know, or one of the package's that is not installed where it was run from, did not start. */
export function boxRan(
  box: RunnerBox,
  world: BoxWorld,
  command: readonly string[],
): SetupChildEnded {
  box.ran.push(command);
  const act = boxActOf(command);
  const program = command[0] ?? "";
  if (act === undefined || (program.includes("/") && !box.paths.has(program)))
    return { ended: "Unstarted" };
  box.acts.push(act);
  const told = box.answers.get(act);
  if (told !== undefined)
    return typeof told === "function" ? told(command) : told;
  const ended = done(box, world, act, command);
  box.after(act);
  return ended;
}
