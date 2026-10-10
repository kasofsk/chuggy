/**
 * `runner`: a runner installed, registered and started on the machine the
 * program is run on, for one project, and said to be done only once the site
 * sees it live.
 *
 * The machine is the record of the machine's things and the site of the
 * site's, and this program keeps neither. Every act is preceded by the probe
 * or the read that would show it already done, so the command is run again
 * after any failure, at any point, and picks up where things stand. Whatever
 * could stop a run without anything having been changed is looked at before
 * the first act: where the project's work runs and whether this person may
 * register for it, the machine's user services, a container engine, the
 * runner's settings and its Claude login, and whether the package could be
 * installed at all.
 *
 * A registration is good where the machine holds a pool file for the project
 * and the site lists the pool it names; otherwise a registration token is
 * minted, which is the one write this program makes at a site, and handed to
 * the package's own `register` as one word of its arguments and nowhere else.
 * The package's own check then runs before its service is started, so nothing
 * is started that the package says cannot work.
 *
 * No password is taken: a child is run with no terminal to ask on, and what
 * would need one is told to the person to do themselves. Nothing a child
 * prints is printed: a failure keeps an excerpt that has been through the
 * redactor with this run's secrets, and everything else said is this
 * program's own words.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type { PlacementRoute } from "../../../../src/contract/rosters.ts";

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiExecutionPlacement,
  apiMintWorkerPoolToken,
  apiProjectAbilities,
  apiSessionPlacement,
  apiWorkerPools,
} from "./apiRoutes.ts";
import { projectAbilityRefused } from "./projectAbilities.ts";
import { runnerPackageOffered, runnerTokenLifetimeSecs } from "./runners.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";
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
  setupPackageProbed,
  setupPoolFiles,
  setupRegisterCommand,
  setupRunnerCommands,
  setupRunnerPlaces,
  setupRunnerPlatform,
  setupRunnerRoom,
  setupSettingsRead,
  setupSettingsText,
  setupUnitIs,
  setupUnitOf,
} from "./setupRunnerMachine.ts";
import type {
  SetupPackageProbe,
  SetupPoolFile,
  SetupRunnerPlaces,
  SetupRunnerRoom,
  SetupSettingsRead,
  SetupUnit,
} from "./setupRunnerMachine.ts";
import { setupCheckFirst } from "./setupRunnerSaid.ts";
import type {
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
  Reload: 60_000,
  Start: 60_000,
  Restart: 60_000,
};

/** How often the site is asked again whether it sees the runner live. */
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

type SetupRunnerAsked = Extract<SetupAsked, { readonly asked: "Runner" }>;

interface Run {
  readonly ports: SetupPorts;
  readonly partition: PartitionIdentity;
  readonly waitSecs: number;
  readonly places: SetupRunnerPlaces;
  readonly notes: SetupRunnerNote[];
  /** What the redactor is told of: every bearer this run held and the registration token it minted. */
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

/** The address of the one write, which is the address the mint is sent to. */
function setupMintPath(partition: PartitionIdentity): string {
  return nativeHttpRoutes.workerPoolRegistrationTokens
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project));
}

const setupMintMethod = "POST";

/**
 * The ports the one write `runner` makes goes out through: the mint of a
 * registration token for this project, and beside it nothing that is not a
 * read.
 */
export function setupMintPorts(
  api: ApiPorts,
  bearer: string,
  partition: PartitionIdentity,
): ApiPorts {
  const reads = setupReadPorts(api, bearer);
  const mint = setupMintPath(partition);
  return {
    ...reads,
    fetch: (url, init) =>
      init.method === setupMintMethod && url === mint
        ? api.fetch(url, init)
        : reads.fetch(url, init),
  };
}

function setupRunnerReads(session: SetupRunnerSession): ApiPorts {
  return setupReadPorts(session.api, session.bearer);
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
  }
}

/** What the machine had before anything was done to it. */
interface Machine {
  readonly engine: SetupEngine;
  readonly settings: Exclude<
    SetupSettingsRead,
    { readonly settings: "Unread" }
  >;
  readonly login: string;
  readonly probe: SetupPackageProbe;
}

/** Everything of the machine that could stop a run, looked at with nothing yet changed. */
async function setupMachineProbed(run: Run): Promise<Machine | Halt> {
  const { ports, places, notes } = run;
  const guide = runnerPackageOffered.guideAddress;
  const settings = setupSettingsRead(ports, places);
  if (settings.settings === "Unread")
    return halt({ stop: "SettingsUnread", path: places.settings, guide });
  const named = settings.settings === "Read" ? settings.engine : undefined;
  const room = await setupRunnerRoom(ports, named);
  if (room.room !== "Open") return halt(setupRoomStop(room));
  notes.push({ note: "Engine", engine: room.engine });
  if (settings.settings === "Read")
    notes.push({ note: "Settings", path: places.settings });
  const login = settings.settings === "Read" ? settings.login : places.login;
  if (ports.disk.kind(login) !== "File")
    return halt({ stop: "LoginMissing", path: login, guide });
  notes.push({ note: "Login", path: login });
  const probe = await setupPackageProbed(ports, places);
  if (probe.found === undefined && probe.prefix === undefined)
    return halt({ stop: "Npmless" });
  return { engine: room.engine, settings, login, probe };
}

interface Exited {
  readonly out: string;
  readonly err: string;
}

/** Runs one thing on the machine to its end, and answers what it printed or the stop its failure is. */
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
  const failed = setupChildFailed(ended, waitMs, run.secrets);
  if (failed !== undefined) return halt({ stop: "Act", act, failed });
  return ended.ended === "Exited" ? ended : { out: "", err: "" };
}

interface Packaged {
  readonly command: string;
  /** Whether this run installed the package, which is whether a service written before it names the old one. */
  readonly installed: boolean;
}

async function setupPackageHad(
  run: Run,
  machine: Machine,
): Promise<Packaged | Halt> {
  const found = machine.probe.found;
  if (found !== undefined) {
    run.notes.push({ note: "Package", ...found });
    return { command: found.command, installed: false };
  }
  const acted = await setupActed(
    run,
    "Install",
    setupInstallCommand(run.places, machine.probe),
  );
  if (halted(acted)) return acted;
  const after = (await setupPackageProbed(run.ports, run.places)).found;
  if (after === undefined)
    return halt({
      stop: "Unseen",
      act: "Install",
      path: setupInstallCommandPath(run.places, machine.probe),
    });
  run.notes.push({ note: "Installed", ...after });
  return { command: after.command, installed: true };
}

/** Writes the settings a machine with none is given, or answers the stop a path that would not be made is. */
function setupSettingsHad(run: Run, machine: Machine): Halt | undefined {
  if (machine.settings.settings !== "Absent") return undefined;
  const path = run.places.settings;
  try {
    run.ports.disk.make(path, setupSettingsText(machine.engine, machine.login));
  } catch (failure: unknown) {
    if (!(failure instanceof SetupMachineError)) throw failure;
    return halt({ stop: "Unwritten", path });
  }
  run.notes.push({ note: "SettingsWritten", path, engine: machine.engine });
  return undefined;
}

/** The pool this machine is registered as, and whether this run registered it. */
interface Pooled {
  readonly file: SetupPoolFile;
  readonly fresh: boolean;
}

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

/** Mints a registration token, which is the one write, and hands it to the package's `register` as one word of its arguments and to nothing else. */
async function setupRegistered(
  run: Run,
  command: string,
): Promise<Pooled | Halt> {
  const lapseMins = Math.ceil(
    Math.max(runnerTokenLifetimeSecs, setupMintLifetimeSecs) / 60,
  );
  const minted = await setupSiteAsked(
    run,
    (session) => setupMintPorts(session.api, session.bearer, run.partition),
    (ports) =>
      apiMintWorkerPoolToken(ports, run.partition, {
        capabilities: [...runnerPackageOffered.platforms],
        lifetimeSecs: setupMintLifetimeSecs,
      }),
  );
  if ("reported" in minted) return minted;
  if (minted.outcome !== "Ok")
    return halt({ stop: "MintRefused", outcome: minted.outcome, lapseMins });
  const token = minted.value.token;
  run.secrets.push(token);
  if (!setupTokenWhole(token))
    return halt({ stop: "MintRefused", outcome: "Unreadable", lapseMins });
  const acted = await setupActed(
    run,
    "Register",
    setupRegisterCommand(command, run.session.site, token),
  );
  if (halted(acted)) return acted;
  const files = setupPoolFiles(run.ports, run.places, run.partition);
  const file =
    files.find((held) => acted.out.includes(`${held.path};`)) ??
    (files.length === 1 ? files[0] : undefined);
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

/** The service of a pool file, and whether this run wrote its unit. */
interface Served {
  readonly unit: SetupUnit;
  readonly written: boolean;
}

/** The service of the pool file: found where its unit is there and names the package this run found, and written by the package's own command otherwise. */
async function setupServiceHad(
  run: Run,
  packaged: Packaged,
  file: SetupPoolFile,
): Promise<Served | Halt> {
  const unit = setupUnitOf(run.places, file);
  const there = (): boolean => run.ports.disk.kind(unit.path) === "File";
  if (there() && !packaged.installed) {
    run.notes.push({ note: "Unit", unit: unit.name });
    return { unit, written: false };
  }
  const acted = await setupActed(
    run,
    "Service",
    setupRunnerCommands.service(packaged.command, file),
  );
  if (halted(acted)) return acted;
  if (!there())
    return halt({ stop: "Unseen", act: "Service", path: unit.path });
  run.notes.push({ note: "UnitWritten", unit: unit.name });
  return { unit, written: true };
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
 * registered the machine or wrote the unit is restarted, since what it runs
 * as is no longer what is there; and whatever is run, the service manager
 * reads its units again first.
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
    run.notes.push({ note: "Started", unit: unit.name });
  }
  const now = await setupUnitIs(run.ports, "is-active", unit);
  return now.is
    ? undefined
    : halt({ stop: "Inactive", unit: unit.name, state: now.said });
}

/** Asks the site, for as long as the run was given, until it sees a runner of the project live by the console's own decider. */
async function setupLive(
  run: Run,
  route: PlacementRoute,
): Promise<SetupRunnerEnded | Halt> {
  const endsAtMs = run.ports.nowMs() + run.waitSecs * 1_000;
  for (;;) {
    const placement = await setupSiteAsked(run, setupRunnerReads, (ports) =>
      apiSessionPlacement(ports, run.partition),
    );
    if ("reported" in placement) return placement;
    const read = setupGot(
      placement,
      (answered) => answered.runners.project,
      setupWhole,
    );
    if (read.read !== "Got") return setupUnread("placement", read);
    const short = sessionRunnerShort(route, read.value);
    if (short === undefined) return { ended: "Live" };
    if (run.ports.nowMs() >= endsAtMs)
      return halt({
        stop: "NotLive",
        waitedSecs: run.waitSecs,
        registered: short === "RunnerOffline",
      });
    await run.ports.sleepMs(setupLivePollMs);
  }
}

/** The acts in their order, each found done or done now, from the package to the service running. */
async function setupMachineDone(
  run: Run,
  machine: Machine,
): Promise<Halt | undefined> {
  const packaged = await setupPackageHad(run, machine);
  if (halted(packaged)) return packaged;
  const settled = setupSettingsHad(run, machine);
  if (halted(settled)) return settled;
  const pooled = await setupPoolHad(run, packaged.command);
  if (halted(pooled)) return pooled;
  const checked = await setupChecked(run, packaged.command, pooled.file);
  if (halted(checked)) return checked;
  const served = await setupServiceHad(run, packaged, pooled.file);
  if (halted(served)) return served;
  const lingering = await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  return setupStarted(run, served.unit, pooled.fresh || served.written);
}

async function setupWalked(run: Run): Promise<SetupRunnerEnded | Halt> {
  const project = await setupProjectAsked(run);
  if (halted(project)) return project;
  if (setupHosted(project.route)) return { ended: "Hosted" };
  const machine = await setupMachineProbed(run);
  if (halted(machine)) return machine;
  const done = await setupMachineDone(run, machine);
  if (halted(done)) return done;
  return setupLive(run, project.route);
}

/**
 * One run of `runner`, to its report. A machine that is not the package's
 * platform is said before anything is asked of a site, and whatever the walk
 * found and did before it stopped is in the report with the stop.
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
  if ("reported" in ended) return ended.reported;
  return said(
    run.session.site,
    run.notes,
    "halt" in ended ? { ended: "Stopped", stop: ended.halt } : ended,
  );
}
