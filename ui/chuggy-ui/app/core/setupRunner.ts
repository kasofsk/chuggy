/**
 * `runner`: a runner installed, registered and started on the machine the
 * program is run on, for one project, and said to be done only once the site
 * sees it live; then, where the person's chats in the project run on runners,
 * the same machine made their chat host, which takes their chats in every
 * project of the workspace, and said to be done only once the site sees this
 * machine live as that host too. One package, one settings file and one
 * Claude credential serve both.
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
 * work. This machine is the person's chat host where it holds a file of the
 * one the site holds for them; otherwise it is registered as theirs the same
 * way, where the workspace lets them, which is the other write. A member has
 * one chat host, so where theirs is another machine it is never replaced: one
 * that is live is left serving, and one that is not is theirs to start or
 * remove.
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
  ChatHostResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";
import type { PlacementRoute } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiChatHost,
  apiExecutionPlacement,
  apiMintChatHostToken,
  apiMintWorkerPoolToken,
  apiPersonalRunnerPermit,
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
  setupChatClient,
  setupChatFiles,
  setupChatPackageLeast,
  setupChildBytesMax,
  setupChildFailed,
  setupInstallCommand,
  setupInstallCommandPath,
  setupLingerByHand,
  setupLingerCommand,
  setupLingerRead,
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
  RegisterChat: 60_000,
  CheckChat: 120_000,
  ServiceChat: 60_000,
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

/** Each write `runner` makes for a project, by its method and its address: the mint of a registration token for the project's runner and for the person's chat host. */
function setupWrites(partition: PartitionIdentity): readonly string[] {
  const filled = (route: string): string =>
    route
      .replace(":tenant", encodeURIComponent(partition.tenant))
      .replace(":project", encodeURIComponent(partition.project));
  return [
    `POST ${filled(nativeHttpRoutes.workerPoolRegistrationTokens)}`,
    `POST ${filled(nativeHttpRoutes.chatHostRegistrationTokens)}`,
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

/** Where the person's chats in the project run, read before anything is touched: whether they run on a chat host, which is the person's. */
async function setupChatsAsked(
  run: Run,
): Promise<{ readonly chats: boolean } | Halt> {
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
  return { chats: !setupHosted(read.value) };
}

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
  /** The oldest package the run can use. */
  readonly least: string;
}

/** Everything of the machine that could stop a run, looked at with nothing yet changed; `least` is the oldest package the run can use. */
async function setupMachineProbed(
  run: Run,
  least: string,
): Promise<Machine | Halt> {
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
  const probe = await setupPackageProbed(ports, places, least);
  const usable =
    probe.found !== undefined && setupPackageCurrent(probe.found, least);
  if (!usable && probe.prefix === undefined) return halt({ stop: "Npmless" });
  return { engine: room.engine, settings, credential, probe, least };
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
    act === "Register" || act === "RegisterChat"
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
  const { least } = machine;
  const found = machine.probe.found;
  if (found !== undefined && setupPackageCurrent(found, least)) {
    run.notes.push({ note: "Package", ...found });
    return { command: found.command, installed: false };
  }
  if (found !== undefined)
    run.notes.push({ note: "Outdated", ...found, least });
  const acted = await setupActed(
    run,
    "Install",
    setupInstallCommand(run.places, machine.probe),
  );
  if (halted(acted)) return acted;
  const after = (await setupPackageProbed(run.ports, run.places, least)).found;
  if (after === undefined || !setupPackageCurrent(after, least)) {
    const made = setupPackageInstalled(run.ports, run.places, machine.probe);
    return halt(
      made === undefined
        ? {
            stop: "Unseen",
            act: "Install",
            path: setupInstallCommandPath(run.places, machine.probe),
          }
        : { stop: "Behind", ...made, least },
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
 * Mints a registration token, as a pool's or as the person's chat host's, and
 * hands it to the package's `register` as one word of its arguments and to
 * nothing else, answering what `register` printed.
 */
async function setupTokenHanded(
  run: Run,
  command: string,
  kind: Exclude<RunnerKind, "Personal">,
): Promise<Exited | Halt> {
  const lapseMins = Math.ceil(
    Math.max(runnerTokenLifetimeSecs, setupMintLifetimeSecs) / 60,
  );
  const asked = { lifetimeSecs: setupMintLifetimeSecs };
  const minted = await setupSiteAsked(run, setupRunnerWrites(run), (ports) =>
    kind === "Pool"
      ? apiMintWorkerPoolToken(ports, run.partition, asked)
      : apiMintChatHostToken(ports, run.partition.tenant, asked),
  );
  if ("reported" in minted) return minted;
  const refused = (outcome: ApiFailure["outcome"]): Halt =>
    halt(
      kind === "Pool"
        ? { stop: "MintRefused", outcome, lapseMins }
        : { stop: "ChatMintRefused", outcome, lapseMins },
    );
  if (minted.outcome !== "Ok") return refused(minted.outcome);
  const token = minted.value.token;
  run.secrets.push(token);
  if (!setupTokenWhole(token)) return refused("Unreadable");
  return setupActed(
    run,
    kind === "Pool" ? "Register" : "RegisterChat",
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

/** The package's own check of the machine for a registration's file, a pool's or the person's chat host's: passed, with its first warning where it gave one, or the first line that failed it, redacted, as the stop. */
async function setupChecked(
  run: Run,
  command: string,
  file: SetupFile,
  kind: Exclude<RunnerKind, "Personal">,
): Promise<Halt | undefined> {
  const act = kind === "Pool" ? "Check" : "CheckChat";
  const waitMs = setupActWaitMs[act];
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
    run.notes.push(
      kind === "Pool"
        ? { note: "Checked", warned: line }
        : { note: "ChatChecked", warned: line },
    );
    return undefined;
  }
  return first === undefined || line === undefined
    ? halt({ stop: "Act", act, failed })
    : halt({ stop: "CheckFailed", act, check: first.check, line });
}

/** The service of a registration's file, and whether this run wrote its unit new or changed it. */
interface Served {
  readonly unit: SetupUnit;
  readonly written: boolean;
}

/**
 * The service of a registration's file, a pool's or the person's chat host's,
 * written by the package's own command on every run, so that it runs the
 * package this run found. A unit that already runs it is written again as it
 * was; one that serves another file, or that the package cannot read back, it
 * refuses.
 */
async function setupServiceHad(
  run: Run,
  packaged: Packaged,
  file: SetupFile,
  kind: Exclude<RunnerKind, "Personal">,
): Promise<Served | Halt> {
  const unit = setupUnitOf(run.places, file);
  const chat = kind === "ChatHost";
  const there = (): boolean => run.ports.disk.kind(unit.path) === "File";
  const held = there();
  const before = setupUnitText(run.ports, unit);
  const act = chat ? "ServiceChat" : "Service";
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
      ? { note: chat ? "ChatUnitWritten" : "UnitWritten", unit: unit.name }
      : { note: chat ? "ChatUnit" : "Unit", unit: unit.name },
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

/** One look at the site for a runner live: the read that saw it, or what the read said instead. */
type SetupLook<Seen, Unseen> =
  { readonly seen: Seen } | { readonly unseen: Unseen } | Halt;

/**
 * Looks at the site, for as long as the run was given, until a look sees the
 * runner live, and answers the read that did. Where the wait runs out this
 * machine's service is asked once more, so one that stopped meanwhile is what
 * is said.
 */
async function setupWaited<Seen extends object, Unseen>(
  run: Run,
  unit: SetupUnit,
  look: () => Promise<SetupLook<Seen, Unseen>>,
  unseen: (last: Unseen) => SetupRunnerStop,
): Promise<Seen | Halt> {
  const endsAtMs = run.ports.nowMs() + run.waitSecs * 1_000;
  for (;;) {
    const looked = await look();
    if (halted(looked)) return looked;
    if ("seen" in looked) return looked.seen;
    if (run.ports.nowMs() >= endsAtMs)
      return (
        (await setupInactive(run, unit, run.waitSecs)) ??
        halt(unseen(looked.unseen))
      );
    await run.ports.sleepMs(setupLivePollMs);
  }
}

/** The project's runner as the console's own decider says it stands on `route`: live, or why not. */
async function setupProjectLooked(
  run: Run,
  route: PlacementRoute,
): Promise<SetupLook<SessionPlacementResponse, SessionRunnerShort>> {
  const placement = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiSessionPlacement(ports, run.partition),
  );
  if ("reported" in placement) return placement;
  const read = setupGot(placement, (answered) => answered, setupWhole);
  if (read.read !== "Got") return setupUnread("placement", read);
  const short = sessionRunnerShort(route, read.value.runners.project);
  return short === undefined ? { seen: read.value } : { unseen: short };
}

/** The package, none older than the machine's least, and the settings, each found or made now, which every service of the runner's runs with. */
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
  const checked = await setupChecked(
    run,
    packaged.command,
    pooled.file,
    "Pool",
  );
  if (halted(checked)) return checked;
  const served = await setupServiceHad(run, packaged, pooled.file, "Pool");
  if (halted(served)) return served;
  const lingering = await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed = pooled.fresh || packaged.installed || served.written;
  return (await setupStarted(run, served.unit, changed)) ?? served.unit;
}

/** The person's chat host as the site holds it in the workspace, or none. */
async function setupChatHad(
  run: Run,
): Promise<{ readonly had: ChatHostResponse | undefined } | Halt> {
  const host = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiChatHost(ports, run.partition.tenant),
  );
  if ("reported" in host) return host;
  if (host.outcome === "Absent") return { had: undefined };
  const read = setupGot(host, (answered) => answered, setupWhole);
  return read.read === "Got" ? { had: read.value } : setupUnread("chat", read);
}

/** Whether the workspace lets the person register a chat host; `pooled` is whether the project's work has a runner, which the stop says is set up, or the cluster. */
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

/** A registration of this machine as the person's chat host, with the id the site holds it by. */
interface Hosting extends Registered<SetupFile> {
  readonly client: string;
}

/** The file among those held of the chat host the site holds for the person, which is what makes this machine theirs. */
function setupChatGood(
  run: Run,
  had: ChatHostResponse | undefined,
  held: readonly SetupFile[],
): Hosting | undefined {
  if (had === undefined) return undefined;
  const file = held.find((each) => setupChatClient(run.ports, each) === had.id);
  return file === undefined
    ? undefined
    : { file, client: had.id, fresh: false };
}

/** The page the person's runners and chat host are listed and removed on. */
function setupMyRunnersPage(run: Run): string {
  const page = settingsRoutes.workspace.myRunner.replace(
    "$tenant",
    encodeURIComponent(run.partition.tenant),
  );
  return `${run.session.site}${page}`;
}

/**
 * This machine registered as the person's chat host, where they hold none
 * and the workspace lets them; a file of one the site no longer holds is said
 * first.
 */
async function setupChatRegistered(
  run: Run,
  command: string,
  held: SetupFile | undefined,
  pooled: boolean,
): Promise<Hosting | Halt> {
  if (held !== undefined)
    run.notes.push({ note: "ChatHostGone", path: held.path });
  const permitted = await setupPermitted(run, pooled);
  if (halted(permitted)) return permitted;
  const acted = await setupTokenHanded(run, command, "ChatHost");
  if (halted(acted)) return acted;
  const file = setupFileSaid(
    acted,
    setupChatFiles(run.ports, run.places, run.partition.tenant),
  );
  if (file === undefined)
    return halt({
      stop: "Unseen",
      act: "RegisterChat",
      path: run.places.pools,
    });
  const client = setupChatClient(run.ports, file);
  if (client === undefined)
    return halt({ stop: "Unseen", act: "RegisterChat", path: file.path });
  run.notes.push({ note: "ChatHostRegistered", path: file.path });
  return { file, client, fresh: true };
}

/** Where the runner's credential cannot be handed to a chat host, the stop that says why: the package refuses one that is a symbolic link, and hands the chat host its directory whole, so refuses one that holds anything else. */
function setupChatLogin(
  run: Run,
  credential: SetupClaudeCredential,
): Halt | undefined {
  const cut = credential.path.lastIndexOf("/");
  const directory = cut === 0 ? "/" : credential.path.slice(0, cut);
  const names = run.ports.disk.names(directory);
  const alone =
    names.length === 1 && names[0] === credential.path.slice(cut + 1);
  const linked = run.ports.disk.linked(credential.path);
  if (alone && !linked) return undefined;
  return halt({
    stop: "ChatLogin",
    how: linked ? "Linked" : "Shared",
    credential,
    settings: run.places.settings,
    login: run.places.login,
  });
}

/** This machine as the site holds the person's chat host: live, or not yet. */
async function setupChatLooked(
  run: Run,
  client: string,
): Promise<SetupLook<ChatHostResponse, undefined>> {
  const host = await setupChatHad(run);
  if (halted(host)) return host;
  const { had } = host;
  return had?.id === client && had.live ? { seen: had } : { unseen: undefined };
}

/**
 * This machine as the person's chat host, which their chats run on: kept
 * where it holds a file of the one the site holds for them, and registered as
 * theirs where they hold none. One on another machine is never replaced, since
 * a member holds one, so a live one is left serving and one that is not live
 * stops the run; `pooled` is whether the project's runner was set up first,
 * which set their services to outlive a logout.
 */
async function setupChatWalked(
  run: Run,
  machine: Machine,
  packaged: Packaged,
  pooled: boolean,
): Promise<SetupRunnerEnded | Halt> {
  const host = await setupChatHad(run);
  if (halted(host)) return host;
  const held = setupChatFiles(run.ports, run.places, run.partition.tenant);
  const good = setupChatGood(run, host.had, held);
  if (good !== undefined)
    run.notes.push({ note: "ChatHost", path: good.file.path });
  else if (host.had?.live === true) {
    run.notes.push({ note: "ChatHostElsewhere" });
    return { ended: "Live" };
  } else if (host.had !== undefined)
    return halt({ stop: "ChatHostOffline", runners: setupMyRunnersPage(run) });
  const shared = setupChatLogin(run, machine.credential);
  if (halted(shared)) return shared;
  const hosting =
    good ?? (await setupChatRegistered(run, packaged.command, held[0], pooled));
  if (halted(hosting)) return hosting;
  const checked = await setupChecked(
    run,
    packaged.command,
    hosting.file,
    "ChatHost",
  );
  if (halted(checked)) return checked;
  const served = await setupServiceHad(run, packaged, hosting.file, "ChatHost");
  if (halted(served)) return served;
  const lingering = pooled ? undefined : await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed = hosting.fresh || packaged.installed || served.written;
  const started = await setupStarted(run, served.unit, changed);
  if (halted(started)) return started;
  const seen = await setupWaited(
    run,
    served.unit,
    () => setupChatLooked(run, hosting.client),
    () => ({ stop: "ChatHostNotLive", waitedSecs: run.waitSecs }),
  );
  if (halted(seen)) return seen;
  run.notes.push({ note: "ChatHostLive" });
  return { ended: "Live" };
}

/** Where the project's work runs on the cluster: nothing is set up where the person's chats do too, and only their chat host where those run on one. */
async function setupHostedWalked(
  run: Run,
  chats: boolean,
): Promise<SetupRunnerEnded | Halt> {
  if (!chats) return { ended: "Hosted" };
  run.notes.push({ note: "Hosted" });
  const machine = await setupMachineProbed(run, setupChatPackageLeast);
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  return setupChatWalked(run, machine, packaged, false);
}

async function setupWalked(run: Run): Promise<SetupRunnerEnded | Halt> {
  const project = await setupProjectAsked(run);
  if (halted(project)) return project;
  const asked = await setupChatsAsked(run);
  if (halted(asked)) return asked;
  const { chats } = asked;
  if (setupHosted(project.route)) return setupHostedWalked(run, chats);
  const least = chats ? setupChatPackageLeast : setupPackageLeast;
  const machine = await setupMachineProbed(run, least);
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  const unit = await setupPoolDone(run, packaged);
  if (halted(unit)) return unit;
  const seen = await setupWaited(
    run,
    unit,
    () => setupProjectLooked(run, project.route),
    (short) => ({
      stop: "NotLive",
      waitedSecs: run.waitSecs,
      registered: short === "RunnerOffline",
    }),
  );
  if (halted(seen)) return seen;
  run.notes.push({ note: "ProjectLive" });
  return chats
    ? setupChatWalked(run, machine, packaged, true)
    : { ended: "Live" };
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
