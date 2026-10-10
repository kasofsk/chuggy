/**
 * A machine for `runner` to be run on, with nothing of this one in it: every
 * command the program runs by name is a stand-in in the home's own directory
 * of programs, and everything they write is under that home or beside it.
 *
 * A case says how the machine's commands answer and which of them it has, and
 * reads back every command that was run, with its words, what it was given to
 * read and whether it led a session of its own. The site sees a runner live
 * once a service of the machine's is up and polls, as it would the real one.
 * The commands that would ask for a password are stood in for too, so one
 * that was run is found and not merely missing.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { machineFiles, machineWrapper } from "./machineShape.ts";
import type {
  MachineCall,
  MachineKnobs,
  MachineState,
} from "./machineShape.ts";
import type { Home } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const script = resolve("test/terminal/machineCommand.ts");

/** What the runner's Claude login holds on a stand-in machine, which nothing may read or print. */
export const machineLoginSecret =
  "sk-ant-oat01-stand-in-claude-login-never-read";

/** The commands that would ask a person for a password. */
export const machineAskers = ["sudo", "su", "pkexec"] as const;

/** What a machine has by name unless a case says otherwise: no podman, as most have none. */
const programs = ["npm", "systemctl", "loginctl", "docker", "git"] as const;

export interface Machine {
  /** Where the runner package keeps its things under this home, and where npm installs. */
  readonly settings: string;
  readonly login: string;
  readonly pools: string;
  readonly units: string;
  readonly prefix: string;
  readonly own: string;
  /** How the machine's commands answer from here on, each named part replacing what was said before. */
  readonly tell: (given: Partial<MachineKnobs>) => void;
  /** Puts a stand-in by this name where a run finds it, or takes it away. */
  readonly has: (name: string, there?: boolean) => void;
  readonly calls: () => readonly MachineCall[];
  /** Forgets the commands run so far, so a case reads only what its next run ran. */
  readonly forget: () => void;
  readonly state: () => MachineState;
  /** What the person did on the machine between two runs. */
  readonly keep: (state: MachineState) => void;
}

function knobsFirst(prefix: string): MachineKnobs {
  return {
    prefix,
    version: "0.3.0",
    pool: "shame",
    engines: { docker: true, podman: true },
    services: true,
    lingerSaid: true,
    lingerAsks: false,
    stays: true,
    polls: true,
    doctor: null,
    fails: {},
  };
}

function lines(path: string): readonly string[] {
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];
}

/** Makes `home` a machine a runner could be put on, and has `installation` see a runner live once a service here is up and polls. */
export function machineStoodIn(home: Home, installation: StandIn): Machine {
  const state = join(home.beside, "machine");
  const prefix = join(home.beside, "prefix");
  const config = join(home.home, ".config");
  const login = join(config, "chuggy-linux", "claude-token");
  const file = (name: keyof typeof machineFiles) =>
    join(state, machineFiles[name]);
  let knobs = knobsFirst(prefix);
  const has = (name: string, there = true): void => {
    rmSync(join(home.bin, name), { force: true });
    if (!there) return;
    const wrapper = machineWrapper(process.execPath, script, state, name);
    writeFileSync(join(home.bin, name), wrapper, { mode: 0o755 });
  };
  const read = (): MachineState =>
    JSON.parse(readFileSync(file("state"), "utf8")) as MachineState;
  for (const made of [
    state,
    join(prefix, "bin"),
    join(prefix, "lib", "node_modules"),
    dirname(login),
  ])
    mkdirSync(made, { recursive: true });
  writeFileSync(file("knobs"), JSON.stringify(knobs));
  writeFileSync(file("state"), JSON.stringify({ linger: false, units: {} }));
  writeFileSync(login, machineLoginSecret, { mode: 0o600 });
  chmodSync(login, 0o600);
  for (const name of [...programs, ...machineAskers]) has(name);
  installation.seen = () => {
    const up = Object.values(read().units).some((unit) => unit.active);
    if (!up || !knobs.polls) return;
    for (const project of installation.world.projects)
      if (project.pools.includes(knobs.pool)) project.runner = "Live";
  };
  return {
    settings: join(config, "chuggy-linux", "runner.json"),
    login,
    pools: join(config, "chuggy", "pools"),
    units: join(config, "systemd", "user"),
    prefix,
    own: join(home.home, ".local"),
    tell: (given) => {
      knobs = { ...knobs, ...given };
      writeFileSync(file("knobs"), JSON.stringify(knobs));
    },
    has,
    calls: () =>
      lines(file("calls")).map((line) => JSON.parse(line) as MachineCall),
    forget: () => {
      rmSync(file("calls"), { force: true });
    },
    state: read,
    keep: (kept) => {
      writeFileSync(file("state"), JSON.stringify(kept));
    },
  };
}
