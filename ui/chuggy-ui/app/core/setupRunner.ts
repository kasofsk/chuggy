/**
 * `runner`: a runner installed, registered and started on the machine the
 * program is run on, for one project, and said to be done only once the site
 * sees it live; then, where the person's chats in the project run on runners,
 * the same machine made their own runner, serving the project, and said to be
 * done only once the site sees that live too. One package, one settings file
 * and one Claude credential serve both.
 *
 * The machine is the record of the machine's things and the site of the
 * site's, and this program keeps neither. Every act is preceded by the probe
 * or the read that would show it already done, but the package's
 * `install-service`, which is run each time because a repeat of it changes
 * nothing; so the command is run again after any failure, at any point, and
 * picks up where things stand. Whatever could stop a run without anything
 * having been changed is looked at before the first act: where the project's
 * work runs and whether this person may register for it, the machine's user
 * services, a container engine the package takes from this user, the
 * runner's settings and its Claude credential, and whether the package could be
 * installed at all.
 *
 * A registration is good where the machine holds a pool file for the project
 * and the site lists the pool it names; otherwise a registration token is
 * minted, a write, and handed to the package's own `register` as one word of
 * its arguments and nowhere else. The package's own check then runs before its
 * service is started, so nothing is started that the package says cannot
 * work. The person's own runner is found where the site has one, and is
 * registered here the same way only where it has none and the workspace lets
 * them: one the site has that this machine holds no file of is on another
 * machine, and is left there. The project is added to what it serves where it
 * is not among them, which is the other write.
 *
 * No password is taken: a child is run with no terminal to ask on, and what
 * would need one is told to the person to do themselves. Nothing a child
 * prints is printed as it came: a failure, or a check that passed with a
 * warning, keeps one excerpt that has been through the redactor with this
 * run's secrets, and a service's state is kept only where it is one word. Of
 * the registration, which is handed the token, nothing printed is kept at
 * all: only which of the package's own refusals it named. Everything else
 * said is this program's own words.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type {
  PersonalRunnerResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";
import type { PlacementRoute } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiExecutionPlacement,
  apiMintPersonalRunnerToken,
  apiMintWorkerPoolToken,
  apiPersonalRunner,
  apiPersonalRunnerPermit,
  apiPersonalRunnerServes,
  apiProjectAbilities,
  apiSessionPlacement,
  apiWorkerPools,
} from "./apiRoutes.ts";
import { projectAbilityRefused } from "./projectAbilities.ts";
import { runnerPackageOffered, runnerTokenLifetimeSecs } from "./runners.ts";
import type { RunnerKind } from "./runners.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";
import type { SessionRunnerShort } from "./sessionRunners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import type { SetupAsked } from "./setupArguments.ts";
import { SetupMachineError } from "./setupPorts.ts";
import type { SetupPorts } from "./setupPorts.ts";
import { setupGot, setupReadPorts } from "./setupReads.ts";
import type { SetupRead } from "./setupReads.ts";
import type { SetupReport } from "./setupReport.ts";
import {
  setupChildBytesMax,
  setupChildFailed,
  setupInstallCommand,
  setupInstallCommandPath,
  setupLingerByHand,
  setupLingerCommand,
  setupLingerRead,
  setupOwnFiles,
  setupPackageCurrent,
  setupPackageInstalled,
  setupPackageLeast,
  setupPackageProbed,
  setupPoolFiles,
  setupRegisterCommand,
  setupRegisterFailed,
  setupRunnerCommands,
  setupRunnerPlaces,
  setupRunnerPlatform,
  setupRunnerRoom,
  setupSettingsRead,
  setupSettingsText,
  setupUnitIs,
  setupUnitOf,
  setupUnitText,
} from "./setupRunnerMachine.ts";
import type {
  SetupFile,
  SetupPackageProbe,
  SetupPoolFile,
  SetupRunnerPlaces,
  SetupRunnerRoom,
  SetupSettingsRead,
  SetupUnit,
} from "./setupRunnerMachine.ts";
import { setupCheckFirst } from "./setupRunnerSaid.ts";
import type {
  SetupClaudeCredential,
  SetupEngine,
  SetupRunnerAct,
  SetupRunnerEnded,
  SetupRunnerNote,
  SetupRunnerRead,
  SetupRunnerStop,
} from "./setupRunnerSaid.ts";
import { setupHosted } from "./setupStanding.ts";
import { setupCommandLine, setupExcerpt, setupSayable } from "./setupText.ts";

/** How long a registration token this program mints stays redeemable: the time one `register` takes, with room, and not the time a person has to paste one. */
export const setupMintLifetimeSecs = 300;

/** How long each thing run on the machine is waited on, which bounds a hang and not the work. */
export const setupActWaitMs: Readonly<Record<SetupRunnerAct, number>> = {
  Install: 300_000,
  Register: 60_000,
  Check: 120_000,
  Service: 60_000,
  RegisterOwn: 60_000,
  ServiceOwn: 60_000,
  Reload: 60_000,
  Start: 60_000,
  Restart: 60_000,
};

/** How often the site is asked again whether it sees a runner live. */
export const setupLivePollMs = 3_000;

/** A sign-in a run works under: the site, its API, and the bearer the run got while it held the lock. */
export interface SetupRunnerSession {
  readonly site: string;
  readonly api: ApiPorts;
  readonly bearer: string;
}

/** What entering the remembered sign-in came to: a session, or the report that says why there is none. */
export type SetupRunnerEntered =
  | { readonly entered: "In"; readonly session: SetupRunnerSession }
  | { readonly entered: "Out"; readonly report: SetupReport };

export type SetupRunnerAsked = Extract<
  SetupAsked,
  { readonly asked: "Runner" }
>;

interface Run {
  readonly ports: SetupPorts;
  readonly partition: PartitionIdentity;
  readonly waitSecs: number;
  readonly places: SetupRunnerPlaces;
  readonly notes: SetupRunnerNote[];
  /** What the redactor is told of: every bearer this run held and every registration token it minted. */
  readonly secrets: string[];
  readonly enter: () => Promise<SetupRunnerEntered>;
  session: SetupRunnerSession;
}

/** Why a walk went no further: a stop of its own, or a report another part of the program makes. */
type Halt =
  { readonly halt: SetupRunnerStop } | { readonly reported: SetupReport };

function halted(value: object | undefined): value is Halt {
  return value !== undefined && ("halt" in value || "reported" in value);
}

function halt(stop: SetupRunnerStop): Halt {
  return { halt: stop };
}

/** Each write `runner` makes for a project, by its method and its address: the mint of a registration token for the project's runner and for the person's own, and the project added to what their own runner serves. */
function setupWrites(partition: PartitionIdentity): readonly string[] {
  const filled = (route: string): string =>
    route
      .replace(":tenant", encodeURIComponent(partition.tenant))
      .replace(":project", encodeURIComponent(partition.project));
  return [
    `POST ${filled(nativeHttpRoutes.workerPoolRegistrationTokens)}`,
    `POST ${filled(nativeHttpRoutes.personalRunnerRegistrationTokens)}`,
    `PUT ${filled(nativeHttpRoutes.personalRunnerProject)}`,
  ];
}

/**
 * The ports every write `runner` makes goes out through: the ones it makes
 * for this project, and beside them nothing that is not a read.
 */
export function setupWritePorts(
  api: ApiPorts,
  bearer: string,
  partition: PartitionIdentity,
): ApiPorts {
  const reads = setupReadPorts(api, bearer);
  const writes = setupWrites(partition);
  return {
    ...reads,
    fetch: (url, init) =>
      writes.includes(`${init.method} ${url}`)
        ? api.fetch(url, init)
        : reads.fetch(url, init),
  };
}

function setupRunnerReads(session: SetupRunnerSession): ApiPorts {
  return setupReadPorts(session.api, session.bearer);
}

function setupRunnerWrites(
  run: Run,
): (session: SetupRunnerSession) => ApiPorts {
  return (session) =>
    setupWritePorts(session.api, session.bearer, run.partition);
}

/**
 * Asks the site one thing under the bearer this run holds. Where the site no
 * longer takes that bearer the sign-in is entered again, under the lock as
 * every run enters it, and the thing is asked once more.
 */
async function setupSiteAsked<T>(
  run: Run,
  portsOf: (session: SetupRunnerSession) => ApiPorts,
  call: (ports: ApiPorts) => Promise<ApiResult<T>>,
): Promise<ApiResult<T> | { readonly reported: SetupReport }> {
  const first = await call(portsOf(run.session));
  if (first.outcome !== "Unauthenticated") return first;
  const again = await run.enter();
  if (again.entered === "Out") return { reported: again.report };
  run.session = again.session;
  run.secrets.push(again.session.bearer);
  return call(portsOf(again.session));
}

function setupUnread(
  read: SetupRunnerRead,
  got: Exclude<SetupRead<unknown>, { readonly read: "Got" }>,
): Halt {
  const outcome =
    got.read === "Refused"
      ? "Refused"
      : got.read === "Failed"
        ? got.outcome
        : "Cut";
  return halt({ stop: "Unread", read, outcome });
}

const setupWhole = (): boolean => true;

/** Where the project's work runs, read before anything is touched: on the cluster, which needs no runner, or on runners this person may register one of. */
async function setupProjectAsked(
  run: Run,
): Promise<{ readonly route: PlacementRoute } | Halt> {
  const work = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiExecutionPlacement(ports, run.partition),
  );
  if ("reported" in work) return work;
  const read = setupGot(work, (answered) => answered.work.route, setupWhole);
  if (read.read !== "Got") return setupUnread("work", read);
  if (setupHosted(read.value)) return { route: read.value };
  const abilities = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiProjectAbilities(ports, run.partition),
  );
  if ("reported" in abilities) return abilities;
  return abilities.outcome === "Ok" &&
    projectAbilityRefused(abilities.value, "administer")
    ? halt({ stop: "NotAdmin" })
    : { route: read.value };
}

/** A room a runner cannot be put in, as the stop it is. */
export function setupRoomStop(
  room: Exclude<SetupRunnerRoom, { readonly room: "Open" }>,
): SetupRunnerStop {
  switch (room.room) {
    case "Mac":
      return { stop: "Mac" };
    case "Serviceless":
      return { stop: "Serviceless", guide: runnerPackageOffered.guideAddress };
    case "Engineless":
      return { stop: "Engineless", asked: room.asked };
    case "DockerBarred":
      return { stop: "DockerBarred", user: room.user, how: room.how };
  }
}

/** What the machine had before anything was done to it. */
interface Machine {
  readonly engine: SetupEngine;
  readonly settings: Exclude<
    SetupSettingsRead,
    { readonly settings: "Unread" }
  >;
  readonly credential: SetupClaudeCredential;
  readonly probe: SetupPackageProbe;
}

/** Everything of the machine that could stop a run, looked at with nothing yet changed. */
async function setupMachineProbed(run: Run): Promise<Machine | Halt> {
  const { ports, places, notes } = run;
  const guide = runnerPackageOffered.guideAddress;
  const settings = setupSettingsRead(ports, places);
  if (settings.settings === "Unread")
    return halt({ stop: "SettingsUnread", path: places.settings, guide });
  const named = settings.settings === "Read" ? settings : undefined;
  const room = await setupRunnerRoom(ports, named);
  if (room.room !== "Open") return halt(setupRoomStop(room));
  notes.push({ note: "Engine", engine: room.engine });
  if (settings.settings === "Read")
    notes.push({ note: "Settings", path: places.settings });
  const credential: SetupClaudeCredential =
    settings.settings === "Read"
      ? settings.credential
      : { kind: "Subscription", path: places.login };
  if (ports.disk.kind(credential.path) !== "File")
    return halt({ stop: "LoginMissing", credential, guide });
  notes.push({ note: "Login", credential });
  const probe = await setupPackageProbed(ports, places);
  const usable = probe.found !== undefined && setupPackageCurrent(probe.found);
  if (!usable && probe.prefix === undefined) return halt({ stop: "Npmless" });
  return { engine: room.engine, settings, credential, probe };
}

interface Exited {
  readonly out: string;
  readonly err: string;
}

/** Runs one thing on the machine to its end, and answers what it printed or the stop its failure is; the registration, which is handed the token, fails with nothing it printed kept. */
async function setupActed(
  run: Run,
  act: SetupRunnerAct,
  command: readonly string[],
): Promise<Exited | Halt> {
  const waitMs = setupActWaitMs[act];
  const ended = await run.ports.process.run(
    command,
    waitMs,
    setupChildBytesMax,
  );
  const failed =
    act === "Register" || act === "RegisterOwn"
      ? setupRegisterFailed(ended, waitMs)
      : setupChildFailed(ended, waitMs, run.secrets);
  if (failed !== undefined) return halt({ stop: "Act", act, failed });
  return ended.ended === "Exited" ? ended : { out: "", err: "" };
}

interface Packaged {
  readonly command: string;
  /** Whether this run installed the package, which is whether a service running from before it runs the old one. */
  readonly installed: boolean;
}

/** The runner package a run can use: the one found, or one installed by the console's command where none is found, or where the one found is older than the least or of a version that cannot be read. */
async function setupPackageHad(
  run: Run,
  machine: Machine,
): Promise<Packaged | Halt> {
  const found = machine.probe.found;
  if (found !== undefined && setupPackageCurrent(found)) {
    run.notes.push({ note: "Package", ...found });
    return { command: found.command, installed: false };
  }
  if (found !== undefined)
    run.notes.push({ note: "Outdated", ...found, least: setupPackageLeast });
  const acted = await setupActed(
    run,
    "Install",
    setupInstallCommand(run.places, machine.probe),
  );
  if (halted(acted)) return acted;
  const after = (await setupPackageProbed(run.ports, run.places)).found;
  if (after === undefined || !setupPackageCurrent(after)) {
    const made = setupPackageInstalled(run.ports, run.places, machine.probe);
    return halt(
      made === undefined
        ? {
            stop: "Unseen",
            act: "Install",
            path: setupInstallCommandPath(run.places, machine.probe),
          }
        : { stop: "Behind", ...made, least: setupPackageLeast },
    );
  }
  const kept =
    found !== undefined &&
    found.command !== after.command &&
    run.ports.disk.kind(found.command) === "File"
      ? found
      : undefined;
  run.notes.push({ note: "Installed", ...after, kept });
  return { command: after.command, installed: true };
}

/** Writes the settings a machine with none is given, or answers the stop a path that would not be made is. */
function setupSettingsHad(run: Run, machine: Machine): Halt | undefined {
  if (machine.settings.settings !== "Absent") return undefined;
  const path = run.places.settings;
  try {
    run.ports.disk.make(
      path,
      setupSettingsText(machine.engine, machine.credential.path),
    );
  } catch (failure: unknown) {
    if (!(failure instanceof SetupMachineError)) throw failure;
    return halt({ stop: "Unwritten", path });
  }
  run.notes.push({ note: "SettingsWritten", path, engine: machine.engine });
  return undefined;
}

/** A registration of this machine, and whether this run made it. */
interface Registered<File extends SetupFile> {
  readonly file: File;
  readonly fresh: boolean;
}

type Pooled = Registered<SetupPoolFile>;

/** The pool file among those held whose pool the site lists, which is what makes a registration good; or that none is, where the site's list was whole. */
async function setupPoolGood(
  run: Run,
  held: readonly SetupPoolFile[],
): Promise<{ readonly good: SetupPoolFile | undefined } | Halt> {
  const pools = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiWorkerPools(ports, run.partition),
  );
  if ("reported" in pools) return pools;
  const read = setupGot(
    pools,
    (answered) => answered.pools.map((listed) => listed.pool),
    (answered) => !answered.truncated,
  );
  if (read.read !== "Got") return setupUnread("pools", read);
  const good = held.find((file) => read.value.includes(file.pool));
  return good === undefined && !read.whole
    ? halt({ stop: "Unread", read: "pools", outcome: "Cut" })
    : { good };
}

/** A token is handed to `register` only where it is one word a command line carries whole. */
function setupTokenWhole(token: string): boolean {
  return setupSayable(token) && /^\S+$/u.test(token);
}

/**
 * Mints a registration token, as a pool's or as the person's own, and hands
 * it to the package's `register` as one word of its arguments and to nothing
 * else, answering what `register` printed.
 */
async function setupTokenHanded(
  run: Run,
  command: string,
  kind: RunnerKind,
): Promise<Exited | Halt> {
  const lapseMins = Math.ceil(
    Math.max(runnerTokenLifetimeSecs, setupMintLifetimeSecs) / 60,
  );
  const asked = {
    capabilities: [...runnerPackageOffered.platforms],
    lifetimeSecs: setupMintLifetimeSecs,
  };
  const minted = await setupSiteAsked(run, setupRunnerWrites(run), (ports) =>
    kind === "Pool"
      ? apiMintWorkerPoolToken(ports, run.partition, asked)
      : apiMintPersonalRunnerToken(ports, run.partition.tenant, asked),
  );
  if ("reported" in minted) return minted;
  const refused = (outcome: ApiFailure["outcome"]): Halt =>
    halt(
      kind === "Pool"
        ? { stop: "MintRefused", outcome, lapseMins }
        : { stop: "OwnMintRefused", outcome, lapseMins },
    );
  if (minted.outcome !== "Ok") return refused(minted.outcome);
  const token = minted.value.token;
  run.secrets.push(token);
  if (!setupTokenWhole(token)) return refused("Unreadable");
  return setupActed(
    run,
    kind === "Pool" ? "Register" : "RegisterOwn",
    setupRegisterCommand(command, run.session.site, token, kind),
  );
}

/** The file `register` said it wrote among those of its kind, or the only one there where it said something else. */
function setupFileSaid<File extends SetupFile>(
  acted: Exited,
  files: readonly File[],
): File | undefined {
  return (
    files.find((held) => acted.out.includes(`${held.path};`)) ??
    (files.length === 1 ? files[0] : undefined)
  );
}

async function setupRegistered(
  run: Run,
  command: string,
): Promise<Pooled | Halt> {
  const acted = await setupTokenHanded(run, command, "Pool");
  if (halted(acted)) return acted;
  const file = setupFileSaid(
    acted,
    setupPoolFiles(run.ports, run.places, run.partition),
  );
  if (file === undefined)
    return halt({ stop: "Unseen", act: "Register", path: run.places.pools });
  run.notes.push({ note: "Registered", path: file.path });
  return { file, fresh: true };
}

async function setupPoolHad(run: Run, command: string): Promise<Pooled | Halt> {
  const held = setupPoolFiles(run.ports, run.places, run.partition);
  const [first] = held;
  if (first === undefined) return setupRegistered(run, command);
  const listed = await setupPoolGood(run, held);
  if (halted(listed)) return listed;
  if (listed.good !== undefined) {
    run.notes.push({ note: "Pool", path: listed.good.path });
    return { file: listed.good, fresh: false };
  }
  run.notes.push({ note: "PoolGone", ...first });
  return setupRegistered(run, command);
}

/** The package's own check of the machine: passed, with its first warning where it gave one, or the first line that failed it, redacted, as the stop. */
async function setupChecked(
  run: Run,
  command: string,
  file: SetupPoolFile,
): Promise<Halt | undefined> {
  const waitMs = setupActWaitMs.Check;
  const ended = await run.ports.process.run(
    setupRunnerCommands.check(command, file),
    waitMs,
    setupChildBytesMax,
  );
  const aside = ended.ended === "Exited" ? ended.err : "";
  const failed = setupChildFailed(ended, waitMs, run.secrets);
  const first =
    (failed === undefined ? undefined : setupCheckFirst(aside, "FAIL")) ??
    setupCheckFirst(aside, "warn");
  const line =
    first === undefined ? undefined : setupExcerpt(first.line, run.secrets);
  if (failed === undefined) {
    run.notes.push({ note: "Checked", warned: line });
    return undefined;
  }
  return first === undefined || line === undefined
    ? halt({ stop: "Act", act: "Check", failed })
    : halt({ stop: "CheckFailed", check: first.check, line });
}

/** The service of a registration's file, and whether this run wrote its unit new or changed it. */
interface Served {
  readonly unit: SetupUnit;
  readonly written: boolean;
}

/**
 * The service of a registration's file, a pool's or the person's own, written
 * by the package's own command on every run, so that it runs the package this
 * run found. A unit that already runs it is written again as it was; one that
 * serves another file, or that the package cannot read back, it refuses.
 */
async function setupServiceHad(
  run: Run,
  packaged: Packaged,
  file: SetupFile,
  kind: RunnerKind,
): Promise<Served | Halt> {
  const unit = setupUnitOf(run.places, file);
  const own = kind === "Personal";
  const there = (): boolean => run.ports.disk.kind(unit.path) === "File";
  const held = there();
  const before = setupUnitText(run.ports, unit);
  const act = own ? "ServiceOwn" : "Service";
  const acted = await setupActed(
    run,
    act,
    setupRunnerCommands.service(packaged.command, file),
  );
  if ("halt" in acted && acted.halt.stop === "Act" && held) {
    const { failed } = acted.halt;
    if (failed.how === "Exit")
      return halt({ stop: "ServiceRefused", act, path: unit.path, failed });
  }
  if (halted(acted)) return acted;
  if (!there()) return halt({ stop: "Unseen", act, path: unit.path });
  const written =
    before === undefined || setupUnitText(run.ports, unit) !== before;
  run.notes.push(
    written
      ? { note: own ? "OwnUnitWritten" : "UnitWritten", unit: unit.name }
      : { note: own ? "OwnUnit" : "Unit", unit: unit.name },
  );
  return { unit, written };
}

/** Lingering is read first and turned on only where it is not on, with no leave to ask for a password; where that fails the person is told the command to run themselves. */
async function setupLingerHad(run: Run): Promise<Halt | undefined> {
  const before = await setupLingerRead(run.ports);
  if (before === "Yes") {
    run.notes.push({ note: "Linger" });
    return undefined;
  }
  const waitMs = setupActWaitMs.Start;
  const failed = setupChildFailed(
    await run.ports.process.run(
      setupLingerCommand(run.ports),
      waitMs,
      setupChildBytesMax,
    ),
    waitMs,
    run.secrets,
  );
  if (failed !== undefined || (await setupLingerRead(run.ports)) === "No")
    return halt({
      stop: "LingerAsks",
      command: setupCommandLine(setupLingerByHand),
      excerpt: failed?.how === "Exit" ? failed.excerpt : "",
    });
  run.notes.push({ note: "LingerOn", read: before === "No" });
  return undefined;
}

/**
 * The service enabled and running. One found running from before this run
 * registered the machine, installed the package or changed the unit is
 * restarted, since what it runs as is no longer what is there; and whatever
 * is run, the service manager reads its units again first.
 */
async function setupStarted(
  run: Run,
  unit: SetupUnit,
  changed: boolean,
): Promise<Halt | undefined> {
  const enabled = await setupUnitIs(run.ports, "is-enabled", unit);
  const active = await setupUnitIs(run.ports, "is-active", unit);
  if (enabled.is && active.is && !changed) {
    run.notes.push({ note: "Running", unit: unit.name });
    return undefined;
  }
  const reloaded = await setupActed(run, "Reload", setupRunnerCommands.reload);
  if (halted(reloaded)) return reloaded;
  if (active.is && changed) {
    const again = await setupActed(
      run,
      "Restart",
      setupRunnerCommands.restart(unit),
    );
    if (halted(again)) return again;
    run.notes.push({ note: "Restarted", unit: unit.name });
  }
  if (!enabled.is || !active.is) {
    const begun = await setupActed(
      run,
      "Start",
      setupRunnerCommands.start(unit),
    );
    if (halted(begun)) return begun;
    run.notes.push({
      note: active.is ? "Enabled" : "Started",
      unit: unit.name,
    });
  }
  return setupInactive(run, unit, undefined);
}

/** Asks the service manager whether the runner's service is running now, and answers the stop it is where it is not. */
async function setupInactive(
  run: Run,
  unit: SetupUnit,
  waitedSecs: number | undefined,
): Promise<Halt | undefined> {
  const now = await setupUnitIs(run.ports, "is-active", unit);
  return now.is
    ? undefined
    : halt({ stop: "Inactive", unit: unit.name, state: now.said, waitedSecs });
}

/**
 * Asks the site, for as long as the run was given, until it sees live the
 * runner `runners` names by the console's own decider on `route`, and answers
 * the read that did. Where the wait runs out a service of this machine's is
 * asked once more, so one that stopped meanwhile is what is said.
 */
async function setupWaited(
  run: Run,
  route: PlacementRoute,
  runners: "project" | "mine",
  unit: SetupUnit | undefined,
  unseen: (short: SessionRunnerShort) => SetupRunnerStop,
): Promise<SessionPlacementResponse | Halt> {
  const endsAtMs = run.ports.nowMs() + run.waitSecs * 1_000;
  for (;;) {
    const placement = await setupSiteAsked(run, setupRunnerReads, (ports) =>
      apiSessionPlacement(ports, run.partition),
    );
    if ("reported" in placement) return placement;
    const read = setupGot(placement, (answered) => answered, setupWhole);
    if (read.read !== "Got") return setupUnread("placement", read);
    const short = sessionRunnerShort(route, read.value.runners[runners]);
    if (short === undefined) return read.value;
    if (run.ports.nowMs() >= endsAtMs)
      return (
        (unit === undefined
          ? undefined
          : await setupInactive(run, unit, run.waitSecs)) ?? halt(unseen(short))
      );
    await run.ports.sleepMs(setupLivePollMs);
  }
}

/** The package and the settings, each found or made now, which every service of the runner's runs with. */
async function setupMachineShared(
  run: Run,
  machine: Machine,
): Promise<Packaged | Halt> {
  const packaged = await setupPackageHad(run, machine);
  if (halted(packaged)) return packaged;
  return setupSettingsHad(run, machine) ?? packaged;
}

/** The project's runner's acts in their order, each found done or done now, from its registration to its service running, which is what is answered. */
async function setupPoolDone(
  run: Run,
  packaged: Packaged,
): Promise<SetupUnit | Halt> {
  const pooled = await setupPoolHad(run, packaged.command);
  if (halted(pooled)) return pooled;
  const checked = await setupChecked(run, packaged.command, pooled.file);
  if (halted(checked)) return checked;
  const served = await setupServiceHad(run, packaged, pooled.file, "Pool");
  if (halted(served)) return served;
  const lingering = await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed = pooled.fresh || packaged.installed || served.written;
  return (await setupStarted(run, served.unit, changed)) ?? served.unit;
}

/** The person's own runner as the site holds it in the workspace, or none. */
async function setupOwnHad(
  run: Run,
): Promise<{ readonly had: PersonalRunnerResponse | undefined } | Halt> {
  const own = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiPersonalRunner(ports, run.partition.tenant),
  );
  if ("reported" in own) return own;
  if (own.outcome === "Absent") return { had: undefined };
  const read = setupGot(own, (answered) => answered, setupWhole);
  return read.read === "Got" ? { had: read.value } : setupUnread("own", read);
}

/** Whether the workspace lets the person register a runner of their own; `pooled` is whether the project's work has a runner, which the stop says is set up, or the cluster. */
async function setupPermitted(
  run: Run,
  pooled: boolean,
): Promise<Halt | undefined> {
  const permit = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiPersonalRunnerPermit(ports, run.partition.tenant),
  );
  if ("reported" in permit) return permit;
  const read = setupGot(permit, (answered) => answered.granted, setupWhole);
  if (read.read !== "Got") return setupUnread("permit", read);
  if (read.value) return undefined;
  const people = settingsRoutes.workspace.people.replace(
    "$tenant",
    encodeURIComponent(run.partition.tenant),
  );
  return halt({
    stop: "PermitWithheld",
    people: `${run.session.site}${people}`,
    work: pooled ? "Runner" : "Cluster",
  });
}

/** This machine registered as the person's own runner where the site has none, which the workspace has to let them; a file left from one the site no longer has is said first. */
async function setupOwnRegistered(
  run: Run,
  command: string,
  held: SetupFile | undefined,
  pooled: boolean,
): Promise<Registered<SetupFile> | Halt> {
  if (held !== undefined) run.notes.push({ note: "OwnGone", path: held.path });
  const permitted = await setupPermitted(run, pooled);
  if (halted(permitted)) return permitted;
  const acted = await setupTokenHanded(run, command, "Personal");
  if (halted(acted)) return acted;
  const file = setupFileSaid(
    acted,
    setupOwnFiles(run.ports, run.places, run.partition.tenant),
  );
  if (file === undefined)
    return halt({ stop: "Unseen", act: "RegisterOwn", path: run.places.pools });
  run.notes.push({ note: "OwnRegistered", path: file.path });
  return { file, fresh: true };
}

/** The project among those the person's own runner serves, found there or added, and then that runner waited on until the site sees it live; `unit` is its service where it is this machine. */
async function setupOwnServed(
  run: Run,
  route: PlacementRoute,
  projects: readonly string[],
  unit: SetupUnit | undefined,
): Promise<SetupRunnerEnded | Halt> {
  if (projects.includes(run.partition.project))
    run.notes.push({ note: "Serves" });
  else {
    const added = await setupSiteAsked(run, setupRunnerWrites(run), (ports) =>
      apiPersonalRunnerServes(ports, run.partition, true),
    );
    if ("reported" in added) return added;
    if (added.outcome !== "Ok")
      return halt({ stop: "ServesRefused", outcome: added.outcome });
    run.notes.push({ note: "ServesAdded" });
  }
  const seen = await setupWaited(run, route, "mine", unit, () => ({
    stop: "OwnNotLive",
    waitedSecs: run.waitSecs,
    here: unit !== undefined,
  }));
  if (halted(seen)) return seen;
  run.notes.push({ note: "OwnLive" });
  return { ended: "Live" };
}

/**
 * The person's own runner, which their chats in the project run on: the one
 * the site has, left where it is where this machine holds no file of it, or
 * this machine registered where the site has none. `pooled` is whether the
 * project's runner was set up first, which set their services to outlive a
 * logout.
 */
async function setupOwnWalked(
  run: Run,
  packaged: Packaged,
  route: PlacementRoute,
  pooled: boolean,
): Promise<SetupRunnerEnded | Halt> {
  const own = await setupOwnHad(run);
  if (halted(own)) return own;
  const [held] = setupOwnFiles(run.ports, run.places, run.partition.tenant);
  let owned: Registered<SetupFile> | Halt;
  if (own.had === undefined)
    owned = await setupOwnRegistered(run, packaged.command, held, pooled);
  else if (held === undefined) {
    run.notes.push({ note: "OwnElsewhere" });
    return setupOwnServed(run, route, own.had.projects, undefined);
  } else {
    run.notes.push({ note: "Own", path: held.path });
    owned = { file: held, fresh: false };
  }
  if (halted(owned)) return owned;
  const served = await setupServiceHad(run, packaged, owned.file, "Personal");
  if (halted(served)) return served;
  const lingering = pooled ? undefined : await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed = owned.fresh || packaged.installed || served.written;
  const started = await setupStarted(run, served.unit, changed);
  if (halted(started)) return started;
  const projects = owned.fresh ? [] : (own.had?.projects ?? []);
  return setupOwnServed(run, route, projects, served.unit);
}

/** Where the project's work runs on the cluster: nothing is set up where the person's chats do too, and only their own runner where those run on runners. */
async function setupHostedWalked(run: Run): Promise<SetupRunnerEnded | Halt> {
  const placement = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiSessionPlacement(ports, run.partition),
  );
  if ("reported" in placement) return placement;
  const read = setupGot(
    placement,
    (answered) => answered.thread.route,
    setupWhole,
  );
  if (read.read !== "Got") return setupUnread("threads", read);
  if (setupHosted(read.value)) return { ended: "Hosted" };
  run.notes.push({ note: "Hosted" });
  const machine = await setupMachineProbed(run);
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  return setupOwnWalked(run, packaged, read.value, false);
}

async function setupWalked(run: Run): Promise<SetupRunnerEnded | Halt> {
  const project = await setupProjectAsked(run);
  if (halted(project)) return project;
  if (setupHosted(project.route)) return setupHostedWalked(run);
  const machine = await setupMachineProbed(run);
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  const unit = await setupPoolDone(run, packaged);
  if (halted(unit)) return unit;
  const seen = await setupWaited(
    run,
    project.route,
    "project",
    unit,
    (short) => ({
      stop: "NotLive",
      waitedSecs: run.waitSecs,
      registered: short === "RunnerOffline",
    }),
  );
  if (halted(seen)) return seen;
  run.notes.push({ note: "ProjectLive" });
  const threads = seen.thread.route;
  return setupHosted(threads)
    ? { ended: "Live" }
    : setupOwnWalked(run, packaged, threads, true);
}

/**
 * One run of `runner`, to its report. A machine that is not the package's
 * platform is said before anything is asked of a site, and whatever the walk
 * found and did before it ended is in the report, also where what ended it is
 * a sign-in the site stopped taking part-way.
 */
export async function setupRunner(
  ports: SetupPorts,
  asked: SetupRunnerAsked,
  enter: () => Promise<SetupRunnerEntered>,
): Promise<SetupReport> {
  const { workspace, project } = asked;
  const said = (
    site: string | undefined,
    notes: readonly SetupRunnerNote[],
    ended: SetupRunnerEnded,
  ): SetupReport => ({
    report: "Runner",
    site,
    workspace,
    project,
    notes,
    ended,
  });
  if (ports.surroundings.platform !== setupRunnerPlatform)
    return said(undefined, [], { ended: "Stopped", stop: { stop: "Mac" } });
  const entered = await enter();
  if (entered.entered === "Out") return entered.report;
  const run: Run = {
    ports,
    partition: { tenant: workspace, project },
    waitSecs: asked.waitSecs,
    places: setupRunnerPlaces(ports.surroundings),
    notes: [],
    secrets: [entered.session.bearer],
    enter,
    session: entered.session,
  };
  const ended = await setupWalked(run);
  if ("reported" in ended)
    return {
      report: "RunnerOut",
      workspace,
      project,
      notes: run.notes,
      out: ended.reported,
    };
  return said(
    run.session.site,
    run.notes,
    "halt" in ended ? { ended: "Stopped", stop: ended.halt } : ended,
  );
}
