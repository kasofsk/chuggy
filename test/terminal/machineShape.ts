/**
 * What a stand-in machine is told and what it keeps, shared by the script
 * that stands in for a machine's own commands and the suite that reads what
 * they did. Nothing here is run, so the script loads nothing but its shape.
 */

/** How a stand-in command fails where a case has it fail, and whether it says its own arguments back as it does. */
export interface MachineFailure {
  readonly exit: number;
  readonly aside: string;
  readonly echoes: boolean;
}

/** The commands a case can have fail, by what each is for. */
export type MachineAct =
  "install" | "register" | "service" | "reload" | "start" | "restart";

/** How the machine's commands answer, which a case says and each command reads as it starts. */
export interface MachineKnobs {
  /** What `npm prefix -g` prints. */
  readonly prefix: string;
  readonly version: string;
  /** The name a registration gives this machine's pool. */
  readonly pool: string;
  /** Whether each container engine that is installed answers this user. */
  readonly engines: Readonly<Record<string, boolean>>;
  /** Whether the user's service manager answers. */
  readonly services: boolean;
  /** Whether the login manager says how lingering stands, and whether turning it on wants a password. */
  readonly lingerSaid: boolean;
  readonly lingerAsks: boolean;
  /** Whether a service that is started stays up, and whether one that is up polls. */
  readonly stays: boolean;
  readonly polls: boolean;
  /** What the runner's check finds, where a case has it find something. */
  readonly doctor: { readonly aside: string; readonly exit: number } | null;
  readonly fails: Readonly<Partial<Record<MachineAct, MachineFailure>>>;
}

/** What the machine's commands have changed that no file of the runner's holds. */
export interface MachineState {
  readonly linger: boolean;
  readonly units: Readonly<
    Record<string, { readonly enabled: boolean; readonly active: boolean }>
  >;
}

/** One command as it was run: its words, what it was given to read, and whether it was started in a session of its own. */
export interface MachineCall {
  readonly name: string;
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly leads: boolean;
}

/** The files a stand-in machine keeps beside its home, by what each holds. */
export const machineFiles = {
  knobs: "knobs.json",
  state: "state.json",
  calls: "calls",
} as const;

/** The header a stand-in runner names itself in, so a write is known to be its own and not the program's. */
export const machineSender = "x-stand-in-sender";

/** A command a shell runs that is the stand-in script run under `name`, keeping the number it was started with. */
export function machineWrapper(
  node: string,
  script: string,
  state: string,
  name: string,
): string {
  return `#!/bin/sh\nexec '${node}' '${script}' '${state}' '${name}' "$@"\n`;
}
