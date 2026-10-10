/**
 * One of every thing a run of `runner` can find, do and stop on, each kind in
 * each of the ways it is said. Neither roster compiles with a kind missing, so
 * the suites that print them check every one.
 */

import { runnerPackageOffered } from "../app/core/runners.ts";
import { setupRegisterRefusals } from "../app/core/setupRunnerSaid.ts";
import type {
  SetupEngine,
  SetupRegisterRefusal,
  SetupRunnerAct,
  SetupRunnerNote,
  SetupRunnerStop,
} from "../app/core/setupRunnerSaid.ts";
import {
  boxLogin,
  boxPoolFile,
  boxPoolName,
  boxPools,
  boxPrefix,
  boxSettings,
  boxUnitName,
  boxUnits,
  boxVersion,
} from "./setupRunnerBox.ts";

const guide = runnerPackageOffered.guideAddress;
export const rosterCommand = `${boxPrefix}/bin/chuggy-linux`;
export const rosterPool = boxPoolFile("acme", "widgets");
export const rosterUnit = boxUnitName("acme", "widgets");

/** What `loginctl` says where turning lingering on wants a password. */
export const rosterLingerRefusal =
  "Could not enable linger: Interactive authentication required.";

const registerRefusals = Object.keys(
  setupRegisterRefusals,
) as SetupRegisterRefusal[];

const acts: readonly SetupRunnerAct[] = [
  "Install",
  "Register",
  "Check",
  "Service",
  "Reload",
  "Start",
  "Restart",
];

export const runnerStops: {
  readonly [Kind in SetupRunnerStop["stop"]]: readonly (SetupRunnerStop & {
    readonly stop: Kind;
  })[];
} = {
  Mac: [{ stop: "Mac" }],
  Unread: [
    { stop: "Unread", read: "work", outcome: "Refused" },
    { stop: "Unread", read: "placement", outcome: "Fault" },
    { stop: "Unread", read: "pools", outcome: "Cut" },
  ],
  NotAdmin: [{ stop: "NotAdmin" }],
  Serviceless: [{ stop: "Serviceless", guide }],
  Engineless: [
    {
      stop: "Engineless",
      asked: [
        { engine: "docker", answered: "No" },
        { engine: "podman", answered: "Absent" },
      ],
    },
    { stop: "Engineless", asked: [{ engine: "podman", answered: "No" }] },
  ],
  DockerBarred: [
    {
      stop: "DockerBarred",
      user: "1001",
      how: { barred: "Named", settings: boxSettings },
    },
    {
      stop: "DockerBarred",
      user: "0",
      how: { barred: "Podmanless", answered: "Absent" },
    },
    {
      stop: "DockerBarred",
      user: undefined,
      how: { barred: "Podmanless", answered: "No" },
    },
  ],
  SettingsUnread: [{ stop: "SettingsUnread", path: boxSettings, guide }],
  LoginMissing: [{ stop: "LoginMissing", path: boxLogin, guide }],
  Npmless: [{ stop: "Npmless" }],
  Unwritten: [{ stop: "Unwritten", path: boxSettings }],
  Act: [
    ...acts.map((act) => ({
      stop: "Act" as const,
      act,
      failed: { how: "Exit" as const, exit: 1, excerpt: "it said why" },
    })),
    { stop: "Act", act: "Install", failed: { how: "Unstarted" } },
    { stop: "Act", act: "Register", failed: { how: "Unended", secs: 60 } },
    {
      stop: "Act",
      act: "Start",
      failed: { how: "Exit", exit: 1, excerpt: "" },
    },
    {
      stop: "Act",
      act: "Register",
      failed: { how: "ExitUnquoted", exit: 1, refusal: undefined },
    },
    ...registerRefusals.map((refusal) => ({
      stop: "Act" as const,
      act: "Register" as const,
      failed: { how: "ExitUnquoted" as const, exit: 2, refusal },
    })),
  ],
  Unseen: [
    { stop: "Unseen", act: "Install", path: rosterCommand },
    { stop: "Unseen", act: "Register", path: boxPools },
    { stop: "Unseen", act: "Service", path: `${boxUnits}/${rosterUnit}` },
  ],
  MintRefused: [
    { stop: "MintRefused", outcome: "Absent", lapseMins: 60 },
    { stop: "MintRefused", outcome: "Conflict", lapseMins: 60 },
    { stop: "MintRefused", outcome: "Fault", lapseMins: 60 },
  ],
  CheckFailed: [
    {
      stop: "CheckFailed",
      check: "container engine",
      line: "FAIL  container engine: docker did not answer",
    },
    { stop: "CheckFailed", check: undefined, line: "FAIL  a new check: no" },
  ],
  LingerAsks: [
    { stop: "LingerAsks", command: "loginctl enable-linger", excerpt: "" },
    {
      stop: "LingerAsks",
      command: "loginctl enable-linger",
      excerpt: rosterLingerRefusal,
    },
  ],
  Inactive: [
    {
      stop: "Inactive",
      unit: rosterUnit,
      state: "failed",
      waitedSecs: undefined,
    },
    { stop: "Inactive", unit: rosterUnit, state: "", waitedSecs: undefined },
    { stop: "Inactive", unit: rosterUnit, state: "activating", waitedSecs: 90 },
    { stop: "Inactive", unit: rosterUnit, state: "", waitedSecs: 0 },
  ],
  NotLive: [
    { stop: "NotLive", waitedSecs: 90, registered: true },
    { stop: "NotLive", waitedSecs: 5, registered: false },
  ],
};

export const runnerNotes: {
  readonly [Kind in SetupRunnerNote["note"]]: readonly (SetupRunnerNote & {
    readonly note: Kind;
  })[];
} = {
  Engine: [{ note: "Engine", engine: "docker" }],
  Package: [
    { note: "Package", command: rosterCommand, version: boxVersion },
    { note: "Package", command: rosterCommand, version: undefined },
  ],
  Installed: [
    { note: "Installed", command: rosterCommand, version: boxVersion },
  ],
  Settings: [{ note: "Settings", path: boxSettings }],
  SettingsWritten: [
    { note: "SettingsWritten", path: boxSettings, engine: "podman" },
  ],
  Login: [{ note: "Login", path: boxLogin }],
  Pool: [{ note: "Pool", path: rosterPool }],
  PoolGone: [{ note: "PoolGone", path: rosterPool, pool: boxPoolName }],
  Registered: [{ note: "Registered", path: rosterPool }],
  Checked: [
    { note: "Checked", warned: undefined },
    { note: "Checked", warned: "warn  job network: it is slow" },
  ],
  Unit: [{ note: "Unit", unit: rosterUnit }],
  UnitWritten: [{ note: "UnitWritten", unit: rosterUnit }],
  Linger: [{ note: "Linger" }],
  LingerOn: [
    { note: "LingerOn", read: true },
    { note: "LingerOn", read: false },
  ],
  Running: [{ note: "Running", unit: rosterUnit }],
  Enabled: [{ note: "Enabled", unit: rosterUnit }],
  Started: [{ note: "Started", unit: rosterUnit }],
  Restarted: [{ note: "Restarted", unit: rosterUnit }],
};

/** Where a machine keeps the things a run names in its lines, and the engine it runs its work in where that is not docker. */
export interface RosterPlaces {
  readonly command: string;
  readonly settings: string;
  readonly login: string;
  readonly pool: string;
  readonly unit: string;
  readonly engine?: SetupEngine;
}

/** What a run prints of each thing it found as it should be, and of each thing it did, for acme/widgets on a machine whose things are at `places`. */
export function rosterLines(places: RosterPlaces) {
  const { command, settings, login, pool, unit, engine = "docker" } = places;
  return {
    found: {
      engine: `found: ${engine} answers you without a password`,
      login: `found: the runner's Claude login is in ${login}`,
      settings: `found: the runner's settings are in ${settings}`,
      package: `found: the runner package is installed: chuggy-linux ${boxVersion}, at ${command}`,
      pool: `found: this machine is registered as a runner of acme/widgets, in ${pool}`,
      check: "found: the runner's own check passed",
      unit: `found: the runner's service is installed: ${unit}`,
      linger: "found: your services keep running after you log out",
      running: `found: ${unit} is enabled and running`,
      live: "found: the site sees a runner of acme/widgets live",
    },
    did: {
      package: `did: installed the runner package, chuggy-linux ${boxVersion}, at ${command}`,
      settings: `did: wrote the runner's settings to ${settings}: its guide's own, with ${engine} as the engine`,
      pool: `did: registered this machine as a runner of acme/widgets, in ${pool}`,
      unit: `did: installed the runner's service, ${unit}`,
      linger: "did: set your services to keep running after you log out",
      enabled: `did: set ${unit}, which was running, to start when you log in`,
      started: `did: started ${unit}, which also starts when you log in`,
      restarted: `did: restarted ${unit}, so it runs as it is now registered and installed`,
    },
  } as const;
}

export const runnerStopsAll: readonly SetupRunnerStop[] =
  Object.values(runnerStops).flat();

export const runnerNotesAll: readonly SetupRunnerNote[] =
  Object.values(runnerNotes).flat();
