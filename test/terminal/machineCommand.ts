/**
 * Every command `runner` runs on a machine, stood in for by one script: the
 * package manager, the runner package, the service manager, the login
 * manager, a container engine, git, and the commands that would ask for a
 * password.
 *
 * It is run as whichever of them a wrapper names, writes down the words it
 * was run with, what it was given to read and whether it leads a session of
 * its own, and then answers as the real one was found to: the runner
 * package's own lines, the files it writes under the home it is run in, and a
 * registration redeemed at the site it is pointed to. It answers from what a
 * case told the machine, and keeps what it changed beside the home. Nothing
 * here reaches anything of the machine it runs on.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { machineFiles, machineSender, machineWrapper } from "./machineShape.ts";
import type {
  MachineAct,
  MachineCall,
  MachineKnobs,
  MachineState,
} from "./machineShape.ts";

const [script = "", state = "", name = "", ...argv] = process.argv.slice(1);

function held<T>(file: string): T {
  return JSON.parse(readFileSync(join(state, file), "utf8")) as T;
}

const knobs = held<MachineKnobs>(machineFiles.knobs);
const home = process.env["HOME"] ?? "";
const set = process.env["XDG_CONFIG_HOME"] ?? "";
const config = set.startsWith("/") ? set : join(home, ".config");
const settings = join(config, "chuggy-linux", "runner.json");
const login = join(config, "chuggy-linux", "claude-token");

/** Whether this process was started in a session of its own, which is one with no terminal to ask anyone anything on. */
function leads(): boolean {
  const stat = readFileSync("/proc/self/stat", "utf8");
  const session = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[3];
  return Number(session) === process.pid;
}

function recorded(): void {
  const call: MachineCall = {
    name,
    argv,
    stdin: readlinkSync("/proc/self/fd/0"),
    leads: leads(),
  };
  appendFileSync(join(state, machineFiles.calls), `${JSON.stringify(call)}\n`);
}

function said(exit: number, out = "", aside = ""): number {
  process.stdout.write(out);
  process.stderr.write(aside);
  return exit;
}

/** What a case has this act fail with, or nothing where it is to do what the real one does. */
function failing(act: MachineAct): number | undefined {
  const failure = knobs.fails[act];
  if (failure === undefined) return undefined;
  const echoed = failure.echoes ? ` (${name} ${argv.join(" ")})` : "";
  return said(failure.exit, "", `${failure.aside}${echoed}\n`);
}

function written(path: string, text: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
}

function npm(): number {
  if (argv[0] === "prefix") return said(0, `${knobs.prefix}\n`);
  if (argv[0] !== "i" || argv[1] !== "-g") return said(1, "", "npm: no\n");
  const failed = failing("install");
  if (failed !== undefined) return failed;
  const at = argv.indexOf("--prefix");
  const prefix = at < 0 ? knobs.prefix : (argv[at + 1] ?? "");
  written(
    join(prefix, "bin", "chuggy-linux"),
    machineWrapper(process.execPath, script, state, "chuggy-linux"),
    0o755,
  );
  written(
    join(prefix, "lib", "node_modules", "chuggy-linux", "package.json"),
    JSON.stringify({ name: "chuggy-linux", version: knobs.version }),
  );
  return said(0, "\nadded 12 packages in 3s\n");
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

function unitOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  return `chuggy-linux-${base}.service`;
}

const units = join(config, "systemd", "user");
const requestMsMax = 10_000;

/** A registration: the token redeemed at the site it names, and the pool's credentials kept in the file the package names for it. */
async function register(): Promise<number> {
  const [, flag, api = "", word = ""] = argv;
  const token = word.startsWith("--token=") ? word.slice(8) : "";
  if (flag !== "--api" || !/^[A-Za-z0-9_-]{43}$/u.test(token))
    return said(2, "", "--token is not a registration token\n");
  const answer = await fetch(`${api}/api/v1/worker-pool-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json", [machineSender]: "runner" },
    body: JSON.stringify({ token, pool: knobs.pool, capabilities: [] }),
    signal: AbortSignal.timeout(requestMsMax),
  });
  if (answer.status !== 201)
    return said(
      1,
      "",
      "the registration token is unknown, spent or expired; mint another in chuggy's console\n",
    );
  const pool = (await answer.json()) as { tenant: string; project: string };
  const file = join(
    config,
    "chuggy",
    "pools",
    `${part(pool.tenant)}.${part(pool.project)}.${knobs.pool}.json`,
  );
  const unit = unitOf(file);
  const wrote = existsSync(file) ? "replaced" : "wrote";
  written(file, JSON.stringify(pool));
  return said(
    0,
    existsSync(join(units, unit))
      ? `${wrote} ${file}; chuggy denies the pool's earlier registration, so its service stops until it is restarted:\n  systemctl --user restart ${unit}\n`
      : `wrote ${file}; next:\n  chuggy-linux doctor --pool ${file}\n  chuggy-linux install-service --pool ${file}\n`,
  );
}

function doctor(file: string): number {
  const pool = file.slice(file.lastIndexOf("/") + 1).replace(/\.json$/u, "");
  const ok = [
    `ok    pool file: ${file} names pool ${pool.replaceAll(".", "/")}`,
    `ok    runner configuration: ${settings}: concurrencyMax 1, sessionsMax 2`,
    "ok    runtime directory: /run/user/1000/chuggy-linux",
    `ok    Claude token file: ${login}, this runner's own`,
    "ok    container engine: docker at unix:///var/run/docker.sock lists 0 of this pool's containers",
    "ok    job network: chuggy-jobs is present",
    "ok    pool token: issued by https://auth.example/oauth2/token",
    "ok    plane: https://pool.chuggy.example/ answered a poll",
  ];
  if (!existsSync(settings))
    return said(
      1,
      `${ok[0] ?? ""}\n`,
      `FAIL  runner configuration: ${settings} is missing\n`,
    );
  return knobs.doctor === null
    ? said(0, `${ok.join("\n")}\n`)
    : said(knobs.doctor.exit, `${ok[0] ?? ""}\n`, knobs.doctor.aside);
}

function service(file: string): number {
  const unit = unitOf(file);
  written(join(units, unit), `[Service]\nExecStart=run ${file}\n`, 0o644);
  return said(
    0,
    `wrote ${join(units, unit)}; start it with:\n  systemctl --user daemon-reload\n  systemctl --user enable --now ${unit}\n  loginctl enable-linger\n`,
  );
}

async function runner(): Promise<number> {
  const last = argv.at(-1) ?? "";
  switch (argv[0] ?? "") {
    case "register":
      return failing("register") ?? register();
    case "doctor":
      return doctor(last);
    case "install-service":
      return failing("service") ?? service(last);
    default:
      return said(2, "", "chuggy-linux: no such command\n");
  }
}

function kept(change: (state: MachineState) => MachineState): void {
  writeFileSync(
    join(state, machineFiles.state),
    JSON.stringify(change(held<MachineState>(machineFiles.state))),
  );
}

/** A unit brought up, which stays up or not as the case says. */
function up(unit: string, enable: boolean): number {
  if (!existsSync(join(units, unit)))
    return said(1, "", `Failed: Unit file ${unit} does not exist.\n`);
  kept((was) => ({
    ...was,
    units: {
      ...was.units,
      [unit]: {
        enabled: enable || was.units[unit]?.enabled === true,
        active: knobs.stays,
      },
    },
  }));
  return said(0);
}

function unitSaid(unit: string, asks: "enabled" | "active"): number {
  const is = held<MachineState>(machineFiles.state).units[unit]?.[asks];
  if (asks === "enabled")
    return said(is === true ? 0 : 1, is === true ? "enabled\n" : "disabled\n");
  return said(is === true ? 0 : 3, is === true ? "active\n" : "inactive\n");
}

function systemctl(): number {
  const [verb = "", ...rest] = argv.filter((word) => word !== "--user");
  const unit = rest.at(-1) ?? "";
  switch (verb) {
    case "show":
      return knobs.services
        ? said(0, "Version=255.4-1ubuntu8\n")
        : said(1, "", "Failed to connect to bus: No medium found\n");
    case "daemon-reload":
      return failing("reload") ?? said(0);
    case "is-enabled":
      return unitSaid(unit, "enabled");
    case "is-active":
      return unitSaid(unit, "active");
    case "enable":
      return failing("start") ?? up(unit, true);
    case "restart":
      return failing("restart") ?? up(unit, false);
    default:
      return said(1, "", "systemctl: no such verb\n");
  }
}

function loginctl(): number {
  if (argv[0] === "show-user") {
    const { linger } = held<MachineState>(machineFiles.state);
    return knobs.lingerSaid
      ? said(0, `Linger=${linger ? "yes" : "no"}\n`)
      : said(1, "", "Failed to get user: No such process\n");
  }
  if (!argv.includes("enable-linger")) return said(1, "", "loginctl: no\n");
  if (knobs.lingerAsks)
    return said(
      1,
      "",
      "Could not enable linger: Interactive authentication required.\n",
    );
  kept((was) => ({ ...was, linger: true }));
  return said(0);
}

function engine(): number {
  return knobs.engines[name] === true
    ? said(0, "27.3.1\n")
    : said(
        1,
        "",
        "permission denied while trying to connect to the daemon socket\n",
      );
}

async function answered(): Promise<number> {
  switch (name) {
    case "npm":
      return npm();
    case "chuggy-linux":
      return runner();
    case "systemctl":
      return systemctl();
    case "loginctl":
      return loginctl();
    case "docker":
    case "podman":
      return engine();
    case "git":
      return said(128, "", "fatal: not a git repository\n");
    default:
      return said(1, "", `${name}: a password is required\n`);
  }
}

recorded();
process.exitCode = await answered();
