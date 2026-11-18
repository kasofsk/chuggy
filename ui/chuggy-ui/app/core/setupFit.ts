/**
 * What a machine is short of for a job that names no memory and no platform,
 * read with nothing changed, and on a Mac what a yes to `runner` changes of
 * Colima's VM, as the words each command is run with.
 *
 * A job naming no memory is given `setupJobMemoryMib`, and the engine needs
 * `setupEngineSpareMib` beside it. The importer gives every such job Linux on
 * amd64, which chuggy-darwin advertises on an arm64 VM only where Colima runs
 * amd64 there through Rosetta, as Linux's binfmt_misc says inside the VM: that
 * is read as chuggy-darwin reads it, so the program and the runner agree.
 *
 * Colima's facts are its v0.10.3's. Docker's info names the VM by Colima's
 * profile ID, `colima` or `colima-<profile>`, as does docker's context where
 * docker answers nothing. A running VM is read from `colima status --json`,
 * whose memory is in bytes and whose driver is a label; a stopped one, of
 * which status says only that it is not running, from `colima list --json`,
 * one object per line, and its VM type from the profile's `colima.yaml`.
 * `colima start --memory` replaces the VM's own value, so it is passed only
 * where that value is known and below the target, and the target is never
 * below it. Colima turns Rosetta on only where macOS has it, and otherwise
 * starts without it and warns, so a Mac without Rosetta is told to install it
 * before anything is restarted. A QEMU VM cannot have Rosetta, and neither
 * can a VM that runs no amd64 though Colima was asked for it, so each is told
 * the delete that makes it again, which nothing here runs. On Linux the engine
 * has the machine's memory, and nothing is resized.
 */

import type { SetupPlatform } from "./setupPorts.ts";

/** The memory, in MiB, a job that names none runs with on a runner, as the plane gives it; a suite holds this to the plane's own. */
export const setupJobMemoryMib = 4_096;

/** The memory, in MiB, the engine is left beside a job, and a chat host beside both. */
export const setupEngineSpareMib = 1_024;

/** The memory, in MiB, an engine needs for a job that names none. */
export const setupJobNeedMib = setupJobMemoryMib + setupEngineSpareMib;

const setupMibPerGib = 1_024;

const setupBytesPerMib = 2 ** 20;

/** What the reads of a Mac go through: a command whose output is answered where it ended well, and a file's text. */
export interface SetupFitProbes {
  readonly read: (command: readonly string[]) => Promise<string | undefined>;
  readonly text: (path: string) => string | undefined;
  readonly home: string | undefined;
  /** Where the person set Colima to keep its profiles, where they set that. */
  readonly colimaHome: string | undefined;
}

/** Colima's own name of its default profile. */
export const setupColimaDefault = "default";

/** The Colima profile of a VM docker names `machine`, or nothing for a VM Colima does not run, as chuggy-darwin reads it. */
export function setupColimaProfile(machine: string): string | undefined {
  if (machine === "colima") return setupColimaDefault;
  return /^colima-([A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(machine)?.[1];
}

/** Colima's VM of one profile, as it was read. */
export interface SetupColimaVm {
  readonly profile: string;
  readonly running: boolean;
  /** Colima's VM type, `vz` or `qemu` or another, where it was read. */
  readonly vmType: string | undefined;
  /** Whether the profile's settings ask for Rosetta. */
  readonly rosettaAsked: boolean;
  readonly memoryMib: number | undefined;
  /** Whether the VM runs amd64 programs: of a stopped one, whether it would once started; nothing where that was not read. */
  readonly amd64: boolean | undefined;
}

/** Colima on a Mac: none this program could read, or a profile with no VM yet, or its VM. */
export type SetupColima =
  | { readonly colima: "Unread" }
  | { readonly colima: "None"; readonly profile: string }
  | { readonly colima: "Vm"; readonly vm: SetupColimaVm };

/** A Mac, as what a job needs of it was read. */
export interface SetupMac {
  readonly silicon: boolean;
  /** Whether macOS runs amd64 programs, which on Apple silicon is whether Rosetta is installed. */
  readonly rosetta: boolean;
  readonly memoryMib: number | undefined;
  readonly colima: SetupColima;
}

/** What `runner` runs of Colima on the person's yes: stopping a running VM first, and then starting it with what changes something. */
export interface SetupColimaChange {
  readonly profile: string;
  /** Whether there is a VM yet, and whether it is running. */
  readonly vm: "None" | "Stopped" | "Running";
  /** The memory the VM has where that was read and what the yes gives it, each in MiB; the second where it is more. */
  readonly hasMib: number | undefined;
  readonly targetMib: number | undefined;
  /** Whether the VM has less memory than a job needs, whether it lacks amd64, and whether the yes gives it Rosetta for it. */
  readonly short: boolean;
  readonly amd64: boolean;
  readonly rosetta: boolean;
  readonly commands: readonly (readonly string[])[];
}

/**
 * What this machine is short of for a job naming no memory or platform:
 * nothing, or nothing this program can tell; memory it cannot be given; a
 * change of Colima a yes makes; Rosetta to install; or Colima's VM to make
 * again, each of the last two told and never run.
 */
export type SetupFit =
  | { readonly fit: "Room" }
  | {
      readonly fit: "Small";
      /** What has too little: the engine, or a Mac whose half is too little. */
      readonly machine: "Engine" | "Mac";
      readonly hasMib: number;
    }
  | ({ readonly fit: "Colima" } & SetupColimaChange)
  | { readonly fit: "Rosettaless"; readonly install: readonly string[] }
  | {
      readonly fit: "Rebuild";
      /** Why Colima's VM gets no Rosetta as it is: it is QEMU's, or it was asked for it and runs no amd64. */
      readonly why: "Qemu" | "Unrosetta";
      readonly commands: readonly (readonly string[])[];
    };

/** The fits a walk stops on, each told the person and never run. */
export type SetupFitTold = Extract<
  SetupFit,
  { readonly fit: "Rosettaless" | "Rebuild" }
>;

/** What installs Rosetta, which can ask for the person's password. */
export const setupRosettaInstall = [
  "softwareupdate",
  "--install-rosetta",
  "--agree-to-license",
] as const;

function setupWhole(text: string | undefined): number | undefined {
  const read = /^\s*(\d+)\s*$/u.exec(text ?? "")?.[1];
  const value = read === undefined ? Number.NaN : Number(read);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function setupMibOf(bytes: unknown): number | undefined {
  return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0
    ? Math.floor(bytes / setupBytesPerMib)
    : undefined;
}

function setupObject(
  text: string,
): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The words that name a profile to Colima, which are none for its default. */
export function setupColimaProfiled(profile: string): readonly string[] {
  return profile === setupColimaDefault ? [] : ["--profile", profile];
}

/** Where Colima keeps a profile's settings: under its home where the person set one, and otherwise under theirs. */
function setupColimaYaml(
  probes: SetupFitProbes,
  profile: string,
): string | undefined {
  const base =
    probes.colimaHome !== undefined && probes.colimaHome.startsWith("/")
      ? probes.colimaHome.replace(/\/+$/u, "")
      : probes.home === undefined
        ? undefined
        : `${probes.home}/.colima`;
  return base === undefined ? undefined : `${base}/${profile}/colima.yaml`;
}

/** The top-level keys of a profile's settings this program goes by: its VM type and whether it asks for Rosetta. */
function setupColimaSettings(
  probes: SetupFitProbes,
  profile: string,
): { readonly vmType: string | undefined; readonly rosettaAsked: boolean } {
  const path = setupColimaYaml(probes, profile);
  const text = path === undefined ? "" : (probes.text(path) ?? "");
  return {
    vmType: /^vmType: *([a-z]+)\s*$/mu.exec(text)?.[1],
    rosettaAsked: /^vzRosetta: *true\s*$/mu.test(text),
  };
}

/** Where Linux lists what it runs other architectures' programs through. */
const setupBinfmt = "/proc/sys/fs/binfmt_misc";

/** Whether a running VM runs amd64 programs: natively, or through an enabled interpreter named rosetta. */
async function setupColimaAmd64(
  probes: SetupFitProbes,
  profile: string,
  arch: unknown,
): Promise<boolean | undefined> {
  if (arch === "x86_64") return true;
  const inside = (argv: readonly string[]) =>
    probes.read(["colima", "ssh", "--profile", profile, "--", ...argv]);
  const listed = await inside(["ls", "-1", setupBinfmt]);
  if (listed === undefined) return undefined;
  if (!listed.split("\n").includes("rosetta")) return false;
  const entry = await inside(["cat", `${setupBinfmt}/rosetta`]);
  return entry === undefined ? undefined : entry.split("\n")[0] === "enabled";
}

/** Colima's label of a VM type in `status`, as the type its settings name. */
function setupColimaDriver(driver: unknown): string | undefined {
  if (driver === "macOS Virtualization.Framework") return "vz";
  if (driver === "QEMU") return "qemu";
  return driver === "Krunkit" ? "krunkit" : undefined;
}

/** A running VM, from what `status` said of it. */
async function setupColimaRunning(
  probes: SetupFitProbes,
  profile: string,
  status: Readonly<Record<string, unknown>>,
): Promise<SetupColimaVm> {
  const { rosettaAsked } = setupColimaSettings(probes, profile);
  return {
    profile,
    running: true,
    vmType: setupColimaDriver(status["driver"]),
    rosettaAsked,
    memoryMib: setupMibOf(status["memory"]),
    amd64: await setupColimaAmd64(probes, profile, status["arch"]),
  };
}

/** A VM that is not running, from its line of `list`, or that there is none, or nothing where `list` did not answer. */
async function setupColimaListed(
  probes: SetupFitProbes,
  profile: string,
): Promise<SetupColima> {
  const listed = await probes.read([
    "colima",
    "list",
    "--json",
    ...setupColimaProfiled(profile),
  ]);
  if (listed === undefined) return { colima: "Unread" };
  const line = listed
    .split("\n")
    .map((each) => setupObject(each))
    .find((each) => each?.["name"] === profile);
  if (line === undefined) return { colima: "None", profile };
  const { vmType, rosettaAsked } = setupColimaSettings(probes, profile);
  const arch = line["arch"];
  return {
    colima: "Vm",
    vm: {
      profile,
      running: false,
      vmType,
      rosettaAsked,
      memoryMib: setupMibOf(line["memory"]),
      amd64: arch === "x86_64" || (vmType === "vz" && rosettaAsked),
    },
  };
}

/** The profile docker names, or that docker's VM is not Colima's: by its info's machine name where it answered, and by its context where it did not, whose own default is the one Colima's default profile leaves until it first starts. */
async function setupColimaNamed(
  probes: SetupFitProbes,
  machine: string | undefined,
): Promise<string | undefined> {
  if (machine !== undefined) return setupColimaProfile(machine);
  const context = (await probes.read(["docker", "context", "show"]))?.trim();
  return context === undefined || context === "default"
    ? setupColimaDefault
    : setupColimaProfile(context);
}

/** Colima here, for the profile docker names; `machine` is the name docker's info gave its machine, where docker answered. */
async function setupColimaRead(
  probes: SetupFitProbes,
  machine: string | undefined,
): Promise<SetupColima | undefined> {
  const profile = await setupColimaNamed(probes, machine);
  if (profile === undefined) return undefined;
  const status = await probes.read([
    "colima",
    "status",
    "--json",
    ...setupColimaProfiled(profile),
  ]);
  const running = status === undefined ? undefined : setupObject(status);
  return running === undefined
    ? setupColimaListed(probes, profile)
    : { colima: "Vm", vm: await setupColimaRunning(probes, profile, running) };
}

/** A Mac as a job needs it, or nothing where docker's VM is not Colima's; `machine` is docker's machine name, where docker answered. */
export async function setupMacRead(
  probes: SetupFitProbes,
  machine: string | undefined,
): Promise<SetupMac | undefined> {
  const colima = await setupColimaRead(probes, machine);
  if (colima === undefined) return undefined;
  const silicon =
    setupWhole(await probes.read(["sysctl", "-n", "hw.optional.arm64"])) === 1;
  const rosetta =
    (await probes.read(["arch", "-x86_64", "/usr/bin/true"])) !== undefined;
  const bytes = setupWhole(await probes.read(["sysctl", "-n", "hw.memsize"]));
  return { silicon, rosetta, memoryMib: setupMibOf(bytes), colima };
}

/** Whole GiB, as Colima takes memory. */
function setupGib(mib: number): string {
  return String(Math.ceil(mib / setupMibPerGib));
}

/** Half a Mac's memory in whole GiB, as MiB, which is what its VM is given at most. */
function setupMacHalfMib(mac: SetupMac): number | undefined {
  return mac.memoryMib === undefined
    ? undefined
    : Math.floor(mac.memoryMib / 2 / setupMibPerGib) * setupMibPerGib;
}

/** What Colima's VM `vm` is short of on `mac`, where it is short of anything, as the change a yes makes. */
function setupColimaChanged(
  mac: SetupMac,
  vm: SetupColimaVm,
): SetupFit | undefined {
  const amd64 = mac.silicon && vm.amd64 === false;
  const rosetta = amd64 && vm.vmType === "vz";
  const short = vm.memoryMib !== undefined && vm.memoryMib < setupJobNeedMib;
  if (vm.running && !short && !amd64) return undefined;
  const half = setupMacHalfMib(mac);
  const target =
    vm.memoryMib === undefined
      ? undefined
      : Math.max(vm.memoryMib, half ?? 0, setupJobNeedMib);
  const targetMib =
    target !== undefined && target > (vm.memoryMib ?? 0) ? target : undefined;
  const profiled = setupColimaProfiled(vm.profile);
  const start = [
    "colima",
    "start",
    ...profiled,
    ...(targetMib === undefined ? [] : ["--memory", setupGib(targetMib)]),
    ...(rosetta ? ["--vz-rosetta"] : []),
  ];
  return {
    fit: "Colima",
    profile: vm.profile,
    vm: vm.running ? "Running" : "Stopped",
    hasMib: vm.memoryMib,
    targetMib,
    short,
    amd64,
    rosetta,
    commands: vm.running ? [["colima", "stop", ...profiled], start] : [start],
  };
}

/** What makes Colima's VM of `profile` anew, as vz with `targetMib`, and with Rosetta where it is wanted. */
function setupColimaMade(
  profile: string,
  targetMib: number,
  rosetta: boolean,
): readonly string[] {
  return [
    "colima",
    "start",
    ...setupColimaProfiled(profile),
    "--vm-type",
    "vz",
    ...(rosetta ? ["--vz-rosetta"] : []),
    "--memory",
    setupGib(targetMib),
  ];
}

/** What a Mac's Colima is short of for a job, where the Mac has room for one. */
function setupMacColimaFit(mac: SetupMac): SetupFit {
  const { colima } = mac;
  if (colima.colima === "Unread") return { fit: "Room" };
  const vm = colima.colima === "Vm" ? colima.vm : undefined;
  const amd64 = mac.silicon && (vm === undefined || vm.amd64 === false);
  if (amd64 && !mac.rosetta)
    return { fit: "Rosettaless", install: setupRosettaInstall };
  const targetMib = Math.max(setupMacHalfMib(mac) ?? 0, setupJobNeedMib);
  if (vm === undefined) {
    const profile =
      colima.colima === "None" ? colima.profile : setupColimaDefault;
    return {
      fit: "Colima",
      profile,
      vm: "None",
      hasMib: undefined,
      targetMib,
      short: true,
      amd64,
      rosetta: mac.silicon && mac.rosetta,
      commands: [
        setupColimaMade(profile, targetMib, mac.silicon && mac.rosetta),
      ],
    };
  }
  const qemu = vm.vmType !== undefined && vm.vmType !== "vz";
  if (amd64 && (qemu || (vm.running && vm.rosettaAsked)))
    return {
      fit: "Rebuild",
      why: qemu ? "Qemu" : "Unrosetta",
      commands: [
        ["colima", "delete", ...setupColimaProfiled(vm.profile)],
        setupColimaMade(
          vm.profile,
          Math.max(vm.memoryMib ?? 0, targetMib),
          true,
        ),
      ],
    };
  return setupColimaChanged(mac, vm) ?? { fit: "Room" };
}

/** Whether a Mac is too small for a job: its half is too little, and its VM has too little or there is none. */
function setupMacSmall(mac: SetupMac): boolean {
  const half = setupMacHalfMib(mac);
  if (half === undefined || half >= setupJobNeedMib) return false;
  const { colima } = mac;
  if (colima.colima === "None") return true;
  return (
    colima.colima === "Vm" &&
    colima.vm.memoryMib !== undefined &&
    colima.vm.memoryMib < setupJobNeedMib
  );
}

/**
 * What this machine is short of for a job naming no memory or platform: on a
 * Mac whose docker runs in Colima, read of the Mac, and otherwise of the
 * engine's memory, `engineMib`, where it was read.
 */
export function setupFitOf(
  platform: SetupPlatform,
  mac: SetupMac | undefined,
  engineMib: number | undefined,
): SetupFit {
  if (platform === "darwin" && mac !== undefined) {
    if (setupMacSmall(mac))
      return { fit: "Small", machine: "Mac", hasMib: mac.memoryMib ?? 0 };
    return setupMacColimaFit(mac);
  }
  return engineMib !== undefined && engineMib < setupJobNeedMib
    ? { fit: "Small", machine: "Engine", hasMib: engineMib }
    : { fit: "Room" };
}
