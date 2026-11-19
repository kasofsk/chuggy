/**
 * `runner`: the person's own runner installed, registered and started on the
 * machine the program is run on, given one project, and said to be done only
 * once the site sees it live and given the project; then, where the person's chats in the project run on runners
 * and the run is named with the chat host flag's yes, which is what setup
 * names unless the person objects, the same machine made their chat host, which takes
 * their chats in every project of the workspace, and said to be done only
 * once the site sees this machine live as that host too. One package, one
 * settings file and one Claude credential serve both. The chat host is sized
 * in those settings before it is set up, to the room the engine's memory has
 * beside a job, where they name no size of their own: every other key of
 * them is kept, and none of the rest is read.
 *
 * The machine is the record of the machine's things and the site of the
 * site's, and this program keeps neither. Every act is preceded by the probe
 * or the read that would show it already done, but the package's
 * `install-service`, which is run each time because a repeat of it changes
 * nothing; so the command is run again after any failure, at any point, and
 * picks up where things stand. Whatever could stop a run without anything
 * having been changed is looked at before the first act: where the project's
 * work runs, whether the workspace lets them register one where this machine holds none the site
 * lists, the machine's user services, a container engine the package takes from this user, the
 * runner's settings and its Claude credential, and whether the package could be
 * installed at all. Named the file of the person's Claude credential where the
 * runner has none, a run copies it into place and does nothing more, so what
 * it would put here is said before it is put.
 *
 * A registration is good where the machine holds a file of a runner the site
 * lists as the person's; otherwise a registration token is minted, a write,
 * and handed to the package's own `register` as one word of its arguments and
 * nowhere else. The package's own check then runs before its service is
 * started, so nothing is started that the package says cannot work. The
 * project is given to the person's runners, a write made only where the site
 * does not say it is so already. This machine is the person's chat host
 * where it holds a file of the one the site holds for them; otherwise it is
 * registered as theirs the same way, where the workspace lets them. A member has
 * one chat host, so where theirs is another machine `runner` never replaces
 * it: one that is live is left serving, and one that is not is theirs to start
 * or remove.
 *
 * `chat-host` is the person's chat host alone, for a workspace: the same walk
 * `runner` makes for it where a project's work needs no runner, which reads no
 * project. Its one write is the chat host's mint. A chat host of theirs on
 * another machine stops it, and is replaced only where `--replace` names it,
 * since registering this machine ends that host's sessions.
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

import type { AccessCallerTenant } from "../../../../src/contract/accessPlane.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type {
  ChatHostResponse,
  PersonalRunnerResponse,
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import type { PlacementRoute } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiChatHost,
  apiExecutionPlacement,
  apiMintChatHostToken,
  apiMintPersonalRunnerToken,
  apiPersonalRunner,
  apiPersonalRunnerPermit,
  apiPersonalRunnerServes,
  apiSessionPlacement,
} from "./apiRoutes.ts";
import { myRunnerShort } from "./myRunner.ts";
import { runnerPackages, runnerTokenLifetimeSecs } from "./runners.ts";
import type { RunnerKind, RunnerPackage } from "./runners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import type { SetupAsked, SetupCredentialGiven } from "./setupArguments.ts";
import { SetupMachineError, setupPlatformOf } from "./setupPorts.ts";
import type { SetupPlatform, SetupPorts } from "./setupPorts.ts";
import { setupGot, setupReadPorts } from "./setupReads.ts";
import type { SetupRead } from "./setupReads.ts";
import type { SetupReport } from "./setupReport.ts";
import {
  setupAgentDomain,
  setupAgentIs,
  setupFileClient,
  setupChatFiles,
  setupChildBytesMax,
  setupChatSized,
  setupChildFailed,
  setupColimaAtLogin,
  setupCredentialPath,
  setupCredentialUnset,
  setupCredentialRead,
  setupEngineInUseRead,
  setupEngineMemoryRead,
  setupInstallCommand,
  setupInstallCommandPath,
  setupLingerByHand,
  setupLingerCommand,
  setupLingerRead,
  setupPackageCurrent,
  setupPackageInstalled,
  setupPackageLeasts,
  setupPackageProbed,
  setupPersonalFiles,
  setupRegisterCommand,
  setupRegisterFailed,
  setupRestartAll,
  setupRunnerCommands,
  setupRunnerPlaces,
  setupRunnerRoom,
  setupSettingsChat,
  setupSettingsChatText,
  setupSettingsHeld,
  setupSettingsRead,
  setupSettingsText,
  setupFitRead,
  setupUnitIs,
  setupUnitShown,
  setupUnitOf,
  setupUnitText,
} from "./setupRunnerMachine.ts";
import type {
  SetupFile,
  SetupPackageProbe,
  SetupRunnerPlaces,
  SetupRunnerRoom,
  SetupServiceIs,
  SetupServicesAt,
  SetupSettingsRead,
  SetupUnit,
} from "./setupRunnerMachine.ts";
import { setupCheckFirst, setupFitStopOf } from "./setupRunnerSaid.ts";
import type {
  SetupClaudeCredential,
  SetupEngine,
  SetupRunnerAct,
  SetupRunnerAt,
  SetupRunnerEnded,
  SetupRunnerNote,
  SetupRunnerRead,
  SetupRunnerStop,
} from "./setupRunnerSaid.ts";
import { setupHosted } from "./setupStanding.ts";
import { setupCommandLine, setupExcerpt, setupSayable } from "./setupText.ts";

/** How long a registration token this program mints stays redeemable: the time one `register` takes, with room, and not the time a person has to paste one. */
export const setupMintLifetimeSecs = 300;

/**
 * How long the chat host's own check is waited on. Where the machine has no
 * chat image the check pulls it, and that first pull is a download far larger
 * than anything else a run fetches, so this bounds a hang and not the pull.
 */
export const setupChatCheckWaitMs = 1_800_000;

/** How long each thing run on the machine is waited on, which bounds a hang and not the work. */
export const setupActWaitMs: Readonly<Record<SetupRunnerAct, number>> = {
  Install: 300_000,
  ServerRemoved: 60_000,
  ServerAdded: 60_000,
  PluginMarketplaceAdd: 300_000,
  PluginMarketplaceUpdate: 300_000,
  PluginInstall: 300_000,
  PluginUpdate: 300_000,
  PluginEnable: 60_000,
  Register: 60_000,
  Check: 120_000,
  Service: 60_000,
  RegisterChat: 60_000,
  CheckChat: setupChatCheckWaitMs,
  ServiceChat: 60_000,
  Reload: 60_000,
  Start: 60_000,
  Restart: 60_000,
  ColimaStop: 120_000,
  ColimaStart: 600_000,
};

/** How often the site is asked again whether it sees a runner live, and a service just started whether it is running. */
export const setupLivePollMs = 3_000;

/**
 * How long a service just started, restarted or loaded is asked after until it
 * is running, which bounds a hang and not the work: thrice the longer restart
 * interval of either package, so a runner that exits as it starts is seen
 * started again.
 */
export const setupServiceUpWaitMs =
  3 *
  Math.max(
    runnerPackages.linux.restartIntervalSecs,
    runnerPackages.darwin.restartIntervalSecs,
  ) *
  1_000;

/** A sign-in a run works under: the site, its API, and the bearer the run got while it held the lock. */
export interface SetupRunnerSession {
  readonly site: string;
  readonly api: ApiPorts;
  readonly bearer: string;
  /** The person's own workspaces, as the site answered them on signing in. */
  readonly workspaces: readonly AccessCallerTenant[];
  /** The GitHub login the site named the person by, where it named one. */
  readonly login: string | undefined;
}

/** Where a run was for, with its workspace's display name where the sign-in's list names that workspace. */
export function setupRunnerAtNamed(
  at: SetupRunnerAt,
  session: SetupRunnerSession,
): SetupRunnerAt {
  const listed = session.workspaces.find(
    (held) => held.tenant === at.workspace,
  );
  return listed === undefined
    ? at
    : { ...at, workspaceName: listed.displayName };
}

/** What entering the remembered sign-in came to: a session, or the report that says why there is none. */
export type SetupRunnerEntered =
  | { readonly entered: "In"; readonly session: SetupRunnerSession }
  | { readonly entered: "Out"; readonly report: SetupReport };

export type SetupRunnerAsked = Extract<
  SetupAsked,
  { readonly asked: "Runner" }
>;

export type SetupChatHostAsked = Extract<
  SetupAsked,
  { readonly asked: "ChatHost" }
>;

/** A run of a command that changes the machine, for the workspace `tenant`, whose writes go out only as `writes`. */
interface Run {
  readonly ports: SetupPorts;
  /** The platform the machine is, whose runner package the run installs and runs, and whose service manager runs its services. */
  readonly platform: SetupPlatform;
  readonly offered: RunnerPackage;
  /** Whether this command installs the runner package where none it can use is found: `chat-host` does, and `runner` finds the one the MCP step's `mcp` installed. */
  readonly installs: boolean;
  readonly tenant: string;
  readonly writes: readonly string[];
  readonly waitSecs: number;
  readonly livePollMs: number;
  readonly places: SetupRunnerPlaces;
  readonly notes: SetupRunnerNote[];
  /** What the redactor is told of: every bearer this run held and every registration token it minted. */
  readonly secrets: string[];
  readonly enter: () => Promise<SetupRunnerEntered>;
  session: SetupRunnerSession;
}

/** A run of `runner`, for one project, which makes this machine the person's own runner and gives it the project; `chatHost` where it is named with the chat host flag's yes, to make this machine the person's chat host too. */
interface ProjectRun extends Run {
  readonly partition: PartitionIdentity;
  readonly chatHost: boolean;
  /** The file the person named as their Claude credential, which a run copies into place and goes no further, where the runner has none. */
  readonly credential: SetupCredentialGiven | undefined;
}

/** Why a walk went no further: a stop of its own, or a report another part of the program makes. */
type Halt =
  { readonly halt: SetupRunnerStop } | { readonly reported: SetupReport };

function halted(value: object | undefined): value is Halt {
  return value !== undefined && ("halt" in value || "reported" in value);
}

/** A walk's own stop, which no part of it that asks nothing of a site can end otherwise. */
type Stopped = { readonly halt: SetupRunnerStop };

function halt(stop: SetupRunnerStop): Stopped {
  return { halt: stop };
}

/** Each write `chat-host` makes in a workspace, by its method and its address: the mint of a registration token for the person's chat host. */
export function setupChatHostWrites(tenant: string): readonly string[] {
  const route = nativeHttpRoutes.chatHostRegistrationTokens.replace(
    ":tenant",
    encodeURIComponent(tenant),
  );
  return [`POST ${route}`];
}

/** Each write `serve` makes for what is due, by its method and its address: the project given to the person's runners. */
export function setupServeWrites(due: {
  readonly partition: PartitionIdentity;
}): readonly string[] {
  const route = nativeHttpRoutes.personalRunnerProject
    .replace(":tenant", encodeURIComponent(due.partition.tenant))
    .replace(":project", encodeURIComponent(due.partition.project));
  return [`PUT ${route}`];
}

/** Each write `runner` makes for a project, by its method and its address: the mint of a registration token for the person's own runner, the project given to their runners, and the mint for the person's chat host where `chat` says this machine is made it. */
export function setupRunnerWrites(
  partition: PartitionIdentity,
  chat: boolean,
): readonly string[] {
  const route = nativeHttpRoutes.personalRunnerRegistrationTokens.replace(
    ":tenant",
    encodeURIComponent(partition.tenant),
  );
  return [
    `POST ${route}`,
    ...setupServeWrites({ partition }),
    ...(chat ? setupChatHostWrites(partition.tenant) : []),
  ];
}

/**
 * The ports every write a run makes goes out through: the `writes` its
 * command makes, and beside them nothing that is not a read.
 */
export function setupWritePorts(
  api: ApiPorts,
  bearer: string,
  writes: readonly string[],
): ApiPorts {
  const reads = setupReadPorts(api, bearer);
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

function setupRunWrites(run: Run): (session: SetupRunnerSession) => ApiPorts {
  return (session) => setupWritePorts(session.api, session.bearer, run.writes);
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

/** Where the person's chats in the project run, read before anything is touched: whether they run on a chat host, which is the person's, and the run is named with the chat host flag's yes. */
async function setupChatsAsked(
  run: ProjectRun,
): Promise<{ readonly chats: boolean } | Halt> {
  if (!run.chatHost) return { chats: false };
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

/** Where the project's work runs, read before anything is touched: on the cluster, which needs no runner, or on runners. */
async function setupProjectAsked(
  run: ProjectRun,
): Promise<{ readonly route: PlacementRoute } | Halt> {
  const work = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiExecutionPlacement(ports, run.partition),
  );
  if ("reported" in work) return work;
  const read = setupGot(work, (answered) => answered.work.route, setupWhole);
  return read.read === "Got"
    ? { route: read.value }
    : setupUnread("work", read);
}

/** A room a runner cannot be put in, as the stop it is, with the guide of the package `offered` where it names one. */
export function setupRoomStop(
  room: Exclude<SetupRunnerRoom, { readonly room: "Open" }>,
  offered: RunnerPackage,
): SetupRunnerStop {
  switch (room.room) {
    case "Serviceless":
      return { stop: "Serviceless", guide: offered.guideAddress };
    case "Engineless":
      return { stop: "Engineless", asked: room.asked, start: room.start };
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
  /** The package the run installs and runs, which is the platform's. */
  readonly offered: RunnerPackage;
  /** The oldest package the run can use. */
  readonly least: string;
}

/** Everything of the machine that could stop a run, looked at with nothing yet changed; `least` is the oldest package the run can use. */
async function setupMachineProbed(
  run: Run,
  least: string,
): Promise<Machine | Halt> {
  const { ports, places, notes, offered } = run;
  const guide = offered.guideAddress;
  const settings = setupSettingsRead(ports, places);
  if (settings.settings === "Unread")
    return halt({ stop: "SettingsUnread", path: places.settings, guide });
  const named = settings.settings === "Read" ? settings : undefined;
  const room = await setupRunnerRoom(ports, named);
  if (room.room !== "Open") return halt(setupRoomStop(room, offered));
  notes.push({ note: "Engine", engine: room.engine });
  if (settings.settings === "Read")
    notes.push({ note: "Settings", path: places.settings });
  const credential: SetupClaudeCredential =
    settings.settings === "Read"
      ? settings.credential
      : setupCredentialUnset(ports, places);
  if (ports.disk.kind(credential.path) !== "File")
    return halt({ stop: "LoginMissing", credential, guide });
  notes.push({ note: "Login", credential });
  const probe = await setupPackageProbed(ports, places, least, offered);
  const usable =
    probe.found !== undefined && setupPackageCurrent(probe.found, least);
  if (!usable && !run.installs)
    return halt({
      stop: "Unpackaged",
      program: offered.program,
      found: probe.found,
      least,
    });
  if (!usable && probe.prefix === undefined) return halt({ stop: "Npmless" });
  return { engine: room.engine, settings, credential, probe, offered, least };
}

interface Exited {
  readonly out: string;
  readonly err: string;
}

/** What running a thing on the machine needs of a run. */
type Acting = Pick<Run, "ports" | "secrets">;

/** What installing the runner package needs of a run. */
type Packaging = Acting & Pick<Run, "places" | "notes">;

/** Runs one thing on the machine to its end, and answers what it printed or the stop its failure is; the registration, which is handed the token, fails with nothing it printed kept. */
export async function setupActed(
  run: Acting,
  act: SetupRunnerAct,
  command: readonly string[],
): Promise<Exited | Stopped> {
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

/** Runs one thing on the machine for a command that holds no secret, answering the stop its failure is, or nothing where it ended well. */
export async function setupActedStop(
  ports: SetupPorts,
  act: SetupRunnerAct,
  command: readonly string[],
): Promise<SetupRunnerStop | undefined> {
  const acted = await setupActed({ ports, secrets: [] }, act, command);
  return "halt" in acted ? acted.halt : undefined;
}

interface Packaged {
  readonly command: string;
  /** Whether this run installed the package, which is whether a service running from before it runs the old one. */
  readonly installed: boolean;
}

/** The runner package a run can use: the one found, or one installed by the console's command where none is found, or where the one found is older than the least or of a version that cannot be read. */
async function setupPackageHad(
  run: Packaging,
  machine: Pick<Machine, "probe" | "offered" | "least">,
): Promise<Packaged | Stopped> {
  const { offered, least } = machine;
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
    setupInstallCommand(run.places, machine.probe, offered),
  );
  if (halted(acted)) return acted;
  const after = (
    await setupPackageProbed(run.ports, run.places, least, offered)
  ).found;
  if (after === undefined || !setupPackageCurrent(after, least)) {
    const made = setupPackageInstalled(
      run.ports,
      run.places,
      machine.probe,
      offered,
    );
    return halt(
      made === undefined
        ? {
            stop: "Unseen",
            act: "Install",
            path: setupInstallCommandPath(run.places, machine.probe, offered),
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

/**
 * The runner package `offered` for a command that needs no more of the
 * machine than it: the one found where it is none older than `least`, and
 * otherwise one the console's command installs, with what was found and done
 * noted in `notes`. Nothing is installed where npm did not say where it
 * installs.
 */
export async function setupPackageReady(
  ports: SetupPorts,
  places: SetupRunnerPlaces,
  notes: SetupRunnerNote[],
  least: string,
  offered: RunnerPackage,
): Promise<{ readonly command: string } | { readonly stop: SetupRunnerStop }> {
  const probe = await setupPackageProbed(ports, places, least, offered);
  const usable =
    probe.found !== undefined && setupPackageCurrent(probe.found, least);
  if (!usable && probe.prefix === undefined)
    return { stop: { stop: "Npmless" } };
  const packaged = await setupPackageHad(
    { ports, places, notes, secrets: [] },
    { probe, offered, least },
  );
  return "halt" in packaged ? { stop: packaged.halt } : packaged;
}

/** Writes the settings a machine with none is given, or answers the stop a path that would not be made is. */
function setupSettingsHad(run: Run, machine: Machine): Halt | undefined {
  if (machine.settings.settings !== "Absent") return undefined;
  const path = run.places.settings;
  try {
    run.ports.disk.make(
      path,
      setupSettingsText(
        run.platform,
        machine.engine,
        setupCredentialUnset(run.ports, run.places),
      ),
    );
  } catch (failure: unknown) {
    if (!(failure instanceof SetupMachineError)) throw failure;
    return halt({ stop: "Unwritten", path });
  }
  run.notes.push({ note: "SettingsWritten", path, engine: machine.engine });
  return undefined;
}

/**
 * The chat host's size, written into the runner's settings where they name
 * no sessions for it: as many as the engine's memory has room for beside
 * what it runs and a job, and one where it has room for none, each taking
 * the memory the settings name or the package's own, keeping every other
 * key, counting what it runs as `colima` found it before any restart too.
 * Answers whether it wrote them, which is whether a running chat host is now
 * stale.
 */
async function setupChatSettingsHad(
  run: Run,
  machine: Machine,
  colima: ColimaHad,
): Promise<{ readonly written: boolean } | Halt> {
  const path = run.places.settings;
  const guide = run.offered.guideAddress;
  const held = setupSettingsHeld(run.ports, run.places);
  const chat = held === undefined ? undefined : setupSettingsChat(held);
  if (held === undefined || chat === undefined)
    return halt({ stop: "SettingsUnread", path, guide });
  if (chat.sessionsMax !== undefined) return { written: false };
  const engineMib = await setupEngineMemoryRead(run.ports, machine.engine);
  const inUseMib = setupInUseLarger(
    colima,
    await setupEngineInUseRead(run.ports, machine.engine),
  );
  const { sessionsMax, sessionMemoryMib } = setupChatSized(
    engineMib,
    inUseMib,
    chat,
  );
  try {
    run.ports.disk.replace(
      path,
      setupSettingsChatText(held, { sessionsMax, sessionMemoryMib }),
    );
  } catch (failure: unknown) {
    if (!(failure instanceof SetupMachineError)) throw failure;
    return halt({ stop: "Unwritten", path });
  }
  run.notes.push({
    note: "ChatSettingsWritten",
    path,
    sessionsMax,
    sessionMemoryMib,
  });
  return { written: true };
}

/** What a run counts in use: the larger of the counts before and after it restarted Colima's VM, since a container the restart stopped is started again; nothing where either was not read. */
function setupInUseLarger(
  colima: ColimaHad,
  afterMib: number | undefined,
): number | undefined {
  if (!colima.restarted) return afterMib;
  const beforeMib = colima.inUseMib;
  return beforeMib === undefined || afterMib === undefined
    ? undefined
    : Math.max(beforeMib, afterMib);
}

/** A registration of this machine, and whether this run made it. */
interface Registered<File extends SetupFile> {
  readonly file: File;
  readonly fresh: boolean;
}

/** A registration of this machine as the person's own runner or their chat host, with the id the site holds it by. */
interface Enrolled extends Registered<SetupFile> {
  readonly client: string;
}

/** A token is handed to `register` only where it is one word a command line carries whole. */
function setupTokenWhole(token: string): boolean {
  return setupSayable(token) && /^\S+$/u.test(token);
}

/** A registration token's mint, as the person's own runner's or their chat host's. */
type Mint = (
  ports: ApiPorts,
  asked: { readonly lifetimeSecs: number },
) => Promise<ApiResult<WorkerPoolTokenResponse>>;

/**
 * Mints a registration token by `mint`, as the person's own runner's or their
 * chat host's, and hands it to the package's `register` as one word of its
 * arguments and to nothing else, answering what `register` printed.
 */
async function setupTokenHanded(
  run: Run,
  command: string,
  kind: Exclude<RunnerKind, "Pool">,
  mint: Mint,
): Promise<Exited | Halt> {
  const lapseMins = Math.ceil(
    Math.max(runnerTokenLifetimeSecs, setupMintLifetimeSecs) / 60,
  );
  const asked = { lifetimeSecs: setupMintLifetimeSecs };
  const minted = await setupSiteAsked(run, setupRunWrites(run), (ports) =>
    mint(ports, asked),
  );
  if ("reported" in minted) return minted;
  const refused = (outcome: ApiFailure["outcome"]): Halt =>
    halt(
      kind === "Personal"
        ? { stop: "MintRefused", outcome, lapseMins }
        : { stop: "ChatMintRefused", outcome, lapseMins },
    );
  if (minted.outcome !== "Ok") return refused(minted.outcome);
  const token = minted.value.token;
  run.secrets.push(token);
  if (!setupTokenWhole(token)) return refused("Unreadable");
  return setupActed(
    run,
    kind === "Personal" ? "Register" : "RegisterChat",
    setupRegisterCommand(run.offered, command, run.session.site, token, kind),
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

/** This machine registered as the person's own runner, which `setupPersonalAsked` found the workspace lets them; a file of one the site no longer knows is said first. */
async function setupPersonalRegistered(
  run: ProjectRun,
  command: string,
  held: SetupFile | undefined,
): Promise<Enrolled | Halt> {
  if (held !== undefined)
    run.notes.push({ note: "PersonalGone", path: held.path });
  const acted = await setupTokenHanded(
    run,
    command,
    "Personal",
    (ports, asked) => apiMintPersonalRunnerToken(ports, run.tenant, asked),
  );
  if (halted(acted)) return acted;
  const file = setupFileSaid(
    acted,
    setupPersonalFiles(run.ports, run.places, run.tenant),
  );
  if (file === undefined)
    return halt({ stop: "Unseen", act: "Register", path: run.places.pools });
  const client = setupFileClient(run.ports, file);
  if (client === undefined)
    return halt({ stop: "Unseen", act: "Register", path: file.path });
  run.notes.push({ note: "PersonalRegistered", path: file.path });
  return { file, client, fresh: true };
}

/** The person's own runners as the site holds them in the workspace, or none where they hold none. */
async function setupPersonalRead(
  run: Run,
): Promise<{ readonly personal: PersonalRunnerResponse | undefined } | Halt> {
  const personal = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiPersonalRunner(ports, run.tenant),
  );
  if ("reported" in personal) return personal;
  if (personal.outcome === "Absent") return { personal: undefined };
  const read = setupGot(personal, (answered) => answered, setupWhole);
  return read.read === "Got"
    ? { personal: read.value }
    : setupUnread("personal", read);
}

/** What this machine holds of the person's own runner: a file of one the site lists as theirs, or what a registration would replace, if anything. */
type PersonalAsked =
  | {
      readonly asked: "Good";
      readonly file: SetupFile;
      readonly client: string;
    }
  | { readonly asked: "Register"; readonly held: SetupFile | undefined };

/** Which of the person's runners this machine holds, read before anything is touched, and where it holds none the site lists, whether the workspace lets them register one. */
async function setupPersonalAsked(
  run: ProjectRun,
): Promise<PersonalAsked | Halt> {
  const held = setupPersonalFiles(run.ports, run.places, run.tenant);
  const [first] = held;
  if (first !== undefined) {
    const read = await setupPersonalRead(run);
    if (halted(read)) return read;
    const listed = new Set(read.personal?.runners.map((runner) => runner.id));
    for (const file of held) {
      const client = setupFileClient(run.ports, file);
      if (client !== undefined && listed.has(client))
        return { asked: "Good", file, client };
    }
  }
  const permitted = await setupPermitted(run, (people) => ({
    stop: "RunnerWithheld",
    people,
  }));
  if (halted(permitted)) return permitted;
  return { asked: "Register", held: first };
}

/** This machine as the person's own runner: kept where it holds a file of a runner the site lists as theirs, and registered otherwise. */
async function setupPersonalHad(
  run: ProjectRun,
  command: string,
  asked: PersonalAsked,
): Promise<Enrolled | Halt> {
  if (asked.asked === "Register")
    return setupPersonalRegistered(run, command, asked.held);
  const { file, client } = asked;
  run.notes.push({ note: "Personal", path: file.path });
  return { file, client, fresh: false };
}

/** The package's own check of the machine for a registration's file, a runner's or the person's chat host's: passed, with its first warning where it gave one, or the first line that failed it, redacted, as the stop. */
async function setupChecked(
  run: Run,
  command: string,
  file: SetupFile,
  kind: RunnerKind,
): Promise<Halt | undefined> {
  const act = kind === "ChatHost" ? "CheckChat" : "Check";
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
      kind === "ChatHost"
        ? { note: "ChatChecked", warned: line }
        : { note: "Checked", warned: line },
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
 * The service of a registration's file, a runner's or the person's chat host's,
 * written by the package's own command on every run, so that it runs the
 * package this run found. A unit that already runs it is written again as it
 * was; one that serves another file, or that the package cannot read back, it
 * refuses.
 */
async function setupServiceHad(
  run: Run,
  packaged: Packaged,
  file: SetupFile,
  kind: RunnerKind,
): Promise<Served | Halt> {
  const unit = setupUnitOf(run.platform, run.places, file);
  const chat = kind === "ChatHost";
  const there = (): boolean => run.ports.disk.kind(unit.path) === "File";
  const held = there();
  const before = setupUnitText(run.ports, unit);
  const act = chat ? "ServiceChat" : "Service";
  const acted = await setupActed(
    run,
    act,
    setupRunnerCommands.service(run.platform, packaged.command, file),
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

/**
 * Lingering is read first and turned on only where it is not on, with no leave
 * to ask for a password; where that fails the person is told the command to
 * run themselves. A Mac has none: launchd runs a person's agents for as long
 * as they have a session.
 */
async function setupLingerHad(run: Run): Promise<Halt | undefined> {
  if (run.platform === "darwin") return undefined;
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
 * The service enabled and running, a Mac's by `setupAgentStarted`. One found
 * running from before this run registered the machine, installed the package
 * or changed the unit is restarted, since what it runs as is no longer what is
 * there; and whatever is run, the service manager reads its units again first.
 */
async function setupStarted(
  run: Run,
  served: Served,
  changed: boolean,
): Promise<Halt | undefined> {
  if (run.platform === "darwin") return setupAgentStarted(run, served, changed);
  const { unit } = served;
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
  return setupInactive(run, unit);
}

/**
 * The agent loaded and running. One found running from before this run that
 * runs as it no longer would is restarted where its file is as it was, and
 * otherwise unloaded and loaded again, which is how launchd reads a file
 * anew; one not running is loaded the same way, the unload's failure saying
 * only that it was not loaded.
 */
async function setupAgentStarted(
  run: Run,
  served: Served,
  changed: boolean,
): Promise<Halt | undefined> {
  const { unit, written } = served;
  const domain = await setupAgentDomain(run.ports);
  const before = await setupAgentIs(run.ports, domain, unit);
  if (before.is && !changed) {
    run.notes.push({ note: "Running", unit: unit.name });
    return undefined;
  }
  if (before.is && !written) {
    const again = await setupActed(
      run,
      "Restart",
      setupRunnerCommands.kick(domain, unit),
    );
    if (halted(again)) return again;
    run.notes.push({ note: "Restarted", unit: unit.name });
    return setupInactive(run, unit);
  }
  await run.ports.process.run(
    setupRunnerCommands.unload(domain, unit),
    setupActWaitMs.Start,
    setupChildBytesMax,
  );
  const begun = await setupActed(
    run,
    "Start",
    setupRunnerCommands.load(domain, unit),
  );
  if (halted(begun)) return begun;
  run.notes.push({
    note: before.is ? "Restarted" : "Started",
    unit: unit.name,
  });
  return setupInactive(run, unit);
}

/** What the platform's service manager says of a service now. */
async function setupRunning(
  run: Run,
  unit: SetupUnit,
): Promise<SetupServiceIs> {
  if (run.platform === "linux") return setupUnitShown(run.ports, unit);
  const domain = await setupAgentDomain(run.ports);
  return setupAgentIs(run.ports, domain, unit);
}

/**
 * Asks the service manager, every poll, until the runner's service just
 * started is running, for no longer than `setupServiceUpWaitMs` or the run's
 * wait, and answers the stop it is where it is still not.
 */
async function setupInactive(
  run: Run,
  unit: SetupUnit,
): Promise<Halt | undefined> {
  const beganMs = run.ports.nowMs();
  const endsAtMs =
    beganMs + Math.min(setupServiceUpWaitMs, run.waitSecs * 1_000);
  for (;;) {
    const now = await setupRunning(run, unit);
    if (now.is) return undefined;
    const atMs = run.ports.nowMs();
    if (atMs >= endsAtMs)
      return halt(
        setupInactiveStop(run, unit, now, {
          waited: "Started",
          waitedSecs: Math.round((atMs - beganMs) / 1_000),
        }),
      );
    await run.ports.sleepMs(Math.min(run.livePollMs, endsAtMs - atMs));
  }
}

/** The stop a service the service manager says is not running is, with what it said of it. */
function setupInactiveStop(
  run: Run,
  unit: SetupUnit,
  now: SetupServiceIs,
  waited: Pick<
    Extract<SetupRunnerStop, { readonly stop: "Inactive" }>,
    "waited" | "waitedSecs"
  >,
): SetupRunnerStop {
  return {
    stop: "Inactive",
    unit: unit.name,
    platform: run.platform,
    state: now.said,
    exit: now.exit,
    ...waited,
  };
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
  unseen: (last: Unseen, pid: number | undefined) => SetupRunnerStop,
): Promise<Seen | Halt> {
  const endsAtMs = run.ports.nowMs() + run.waitSecs * 1_000;
  for (;;) {
    const looked = await look();
    if (halted(looked)) return looked;
    if ("seen" in looked) return looked.seen;
    if (run.ports.nowMs() >= endsAtMs) {
      const now = await setupRunning(run, unit);
      return halt(
        now.is
          ? unseen(looked.unseen, now.pid)
          : setupInactiveStop(run, unit, now, {
              waited: "Live",
              waitedSecs: run.waitSecs,
            }),
      );
    }
    await run.ports.sleepMs(run.livePollMs);
  }
}

/** The person's own runner of `client` as the site holds it: live and given the project, or whether it is listed at all. */
async function setupPersonalLooked(
  run: ProjectRun,
  client: string,
): Promise<SetupLook<{ readonly listed: true }, { readonly listed: boolean }>> {
  const read = await setupPersonalRead(run);
  if (halted(read)) return read;
  const runner = read.personal?.runners.find((each) => each.id === client);
  const given =
    read.personal?.projects.some(
      (each) => each.project === run.partition.project,
    ) === true;
  return runner?.live === true && given
    ? { seen: { listed: true } }
    : { unseen: { listed: runner !== undefined } };
}

/** The write that lets the person's own runner take their work in the project, made only where the site does not say it is so already. */
async function setupServed(run: ProjectRun): Promise<Halt | undefined> {
  const read = await setupPersonalRead(run);
  if (halted(read)) return read;
  const given =
    read.personal?.projects.some(
      (each) => each.project === run.partition.project,
    ) === true;
  if (!given) {
    const written = await setupSiteAsked(run, setupRunWrites(run), (ports) =>
      apiPersonalRunnerServes(ports, run.partition, true),
    );
    if ("reported" in written) return written;
    if (written.outcome !== "Ok")
      return halt({ stop: "ServeRefused", outcome: written.outcome });
  }
  run.notes.push({ note: "Given", now: !given });
  return undefined;
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

/** The person's own runner's acts in their order, each found done or done now, from its registration to its service running, which is answered with the id the site holds it by. */
async function setupPersonalDone(
  run: ProjectRun,
  packaged: Packaged,
  asked: PersonalAsked,
): Promise<{ readonly unit: SetupUnit; readonly client: string } | Halt> {
  const enrolled = await setupPersonalHad(run, packaged.command, asked);
  if (halted(enrolled)) return enrolled;
  const checked = await setupChecked(
    run,
    packaged.command,
    enrolled.file,
    "Personal",
  );
  if (halted(checked)) return checked;
  const served = await setupServiceHad(
    run,
    packaged,
    enrolled.file,
    "Personal",
  );
  if (halted(served)) return served;
  const lingering = await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed = enrolled.fresh || packaged.installed || served.written;
  const started = await setupStarted(run, served, changed);
  if (halted(started)) return started;
  return { unit: served.unit, client: enrolled.client };
}

/** The person's chat host as the site holds it in the workspace, or none. */
async function setupChatHad(
  run: Run,
): Promise<{ readonly had: ChatHostResponse | undefined } | Halt> {
  const host = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiChatHost(ports, run.tenant),
  );
  if ("reported" in host) return host;
  if (host.outcome === "Absent") return { had: undefined };
  const read = setupGot(host, (answered) => answered, setupWhole);
  return read.read === "Got" ? { had: read.value } : setupUnread("chat", read);
}

/** Whether the workspace lets the person register a runner of their own or a chat host, with `withheld` the stop where it does not, given its People page. */
async function setupPermitted(
  run: Run,
  withheld: (people: string) => SetupRunnerStop,
): Promise<Halt | undefined> {
  const permit = await setupSiteAsked(run, setupRunnerReads, (ports) =>
    apiPersonalRunnerPermit(ports, run.tenant),
  );
  if ("reported" in permit) return permit;
  const read = setupGot(permit, (answered) => answered.granted, setupWhole);
  if (read.read !== "Got") return setupUnread("permit", read);
  if (read.value) return undefined;
  const people = settingsRoutes.workspace.people.replace(
    "$tenant",
    encodeURIComponent(run.tenant),
  );
  return halt(withheld(`${run.session.site}${people}`));
}

/** The file among those held of the chat host the site holds for the person, which is what makes this machine theirs. */
function setupChatGood(
  run: Run,
  had: ChatHostResponse | undefined,
  held: readonly SetupFile[],
): Enrolled | undefined {
  if (had === undefined) return undefined;
  const file = held.find((each) => setupFileClient(run.ports, each) === had.id);
  return file === undefined
    ? undefined
    : { file, client: had.id, fresh: false };
}

/** The page the person's runners and chat host are listed and removed on. */
function setupMyRunnersPage(run: Run): string {
  const page = settingsRoutes.workspace.myRunner.replace(
    "$tenant",
    encodeURIComponent(run.tenant),
  );
  return `${run.session.site}${page}`;
}

/**
 * This machine registered as the person's chat host, where they hold none,
 * or in place of `replaced` where `chat-host` was told to, and the workspace
 * lets them; a file of one the site no longer holds is said first.
 */
async function setupChatRegistered(
  run: Run,
  command: string,
  held: SetupFile | undefined,
  of: ChatOf,
  replaced: string | undefined,
): Promise<Enrolled | Halt> {
  if (held !== undefined)
    run.notes.push({ note: "ChatHostGone", path: held.path });
  const work =
    of.of === "ChatHost" ? undefined : of.pooled ? "Runner" : "Cluster";
  const permitted = await setupPermitted(run, (people) => ({
    stop: "PermitWithheld",
    people,
    work,
  }));
  if (halted(permitted)) return permitted;
  const acted = await setupTokenHanded(
    run,
    command,
    "ChatHost",
    (ports, asked) => apiMintChatHostToken(ports, run.tenant, asked),
  );
  if (halted(acted)) return acted;
  const file = setupFileSaid(
    acted,
    setupChatFiles(run.ports, run.places, run.tenant),
  );
  if (file === undefined)
    return halt({
      stop: "Unseen",
      act: "RegisterChat",
      path: run.places.pools,
    });
  const client = setupFileClient(run.ports, file);
  if (client === undefined)
    return halt({ stop: "Unseen", act: "RegisterChat", path: file.path });
  run.notes.push(
    replaced === undefined
      ? { note: "ChatHostRegistered", path: file.path }
      : { note: "ChatHostReplaced", path: file.path, short: replaced },
  );
  return { file, client, fresh: true };
}

/** Where the runner's services are on this machine, which on a Mac is the launchd domain they load in. */
async function setupServicesAt(run: Run): Promise<SetupServicesAt> {
  return run.platform === "darwin"
    ? { platform: "darwin", domain: await setupAgentDomain(run.ports) }
    : { platform: "linux" };
}

/** Where the runner's credential cannot be handed to a chat host, the stop that says why: the package refuses one that is a symbolic link, and hands the chat host its directory whole, so refuses one that holds anything else. */
async function setupChatLogin(
  run: Run,
  credential: SetupClaudeCredential,
): Promise<Halt | undefined> {
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
    restart: setupRestartAll(run.places, await setupServicesAt(run)),
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
 * What a walk of the person's chat host is part of: `runner`, `pooled` where
 * the project's runner was set up first, which set their services to outlive
 * a logout; or `chat-host`, told by `replace` which chat host of theirs it may
 * register this machine in place of.
 */
type ChatOf =
  | { readonly of: "Runner"; readonly pooled: boolean }
  | { readonly of: "ChatHost"; readonly replace: string | undefined };

/**
 * A chat host of the person's on another machine: `runner` never replaces
 * one, leaving a live one serving and stopping on one that is not live, and
 * `chat-host` stops on either, going on to register this machine in its
 * place, answering nothing, only where `--replace` named it.
 */
function setupChatElsewhere(
  run: Run,
  had: ChatHostResponse,
  of: ChatOf,
): SetupRunnerEnded | Halt | undefined {
  if (of.of === "Runner") {
    if (!had.live)
      return halt({
        stop: "ChatHostOffline",
        runners: setupMyRunnersPage(run),
      });
    run.notes.push({ note: "ChatHostElsewhere" });
    return { ended: "Live" };
  }
  const short = myRunnerShort(had.id);
  if (of.replace === short) return undefined;
  return halt({
    stop: of.replace === undefined ? "ChatHostHeld" : "ReplaceMismatched",
    short,
    live: had.live,
  });
}

/**
 * This machine as the person's chat host, which their chats run on: kept
 * where it holds a file of the one the site holds for them, registered as
 * theirs where they hold none, and where theirs is another machine, as `of`
 * says.
 */
async function setupChatWalked(
  run: Run,
  machine: Machine,
  packaged: Packaged,
  of: ChatOf,
  colima: ColimaHad,
): Promise<SetupRunnerEnded | Halt> {
  const host = await setupChatHad(run);
  if (halted(host)) return host;
  const held = setupChatFiles(run.ports, run.places, run.tenant);
  const good = setupChatGood(run, host.had, held);
  const elsewhere =
    good === undefined && host.had !== undefined ? host.had : undefined;
  if (good !== undefined)
    run.notes.push({ note: "ChatHost", path: good.file.path });
  else if (elsewhere !== undefined) {
    const kept = setupChatElsewhere(run, elsewhere, of);
    if (kept !== undefined) return kept;
  }
  const shared = await setupChatLogin(run, machine.credential);
  if (halted(shared)) return shared;
  const sized = await setupChatSettingsHad(run, machine, colima);
  if (halted(sized)) return sized;
  const replaced =
    elsewhere === undefined ? undefined : myRunnerShort(elsewhere.id);
  const hosting =
    good ??
    (await setupChatRegistered(run, packaged.command, held[0], of, replaced));
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
  const pooled = of.of === "Runner" && of.pooled;
  const lingering = pooled ? undefined : await setupLingerHad(run);
  if (halted(lingering)) return lingering;
  const changed =
    hosting.fresh || packaged.installed || served.written || sized.written;
  const started = await setupStarted(run, served, changed);
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

/** The person's chat host alone on this machine: the machine looked at, the package and the settings had, and then the chat host's own walk. */
async function setupChatAlone(
  run: Run,
  of: ChatOf,
): Promise<SetupRunnerEnded | Halt> {
  const machine = await setupMachineProbed(
    run,
    setupPackageLeasts[run.platform].chat,
  );
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  return setupChatWalked(run, machine, packaged, of, { restarted: false });
}

/** Where the project's work runs on the cluster: nothing is set up where the person's chats do too, and only their chat host where those run on one. */
async function setupHostedWalked(
  run: Run,
  chats: boolean,
): Promise<SetupRunnerEnded | Halt> {
  if (!chats) return { ended: "Hosted" };
  run.notes.push({ note: "Hosted" });
  return setupChatAlone(run, { of: "Runner", pooled: false });
}

/** Whether a run restarted Colima's running VM, and if so what its running containers took before, which is what the offer counted. */
type ColimaHad =
  | { readonly restarted: false }
  | { readonly restarted: true; readonly inUseMib: number | undefined };

/** On a Mac, Colima's VM given what a job needs where a run can give it, or the stop of what only the person can mend; then what the VM has. */
async function setupColimaHad(run: Run): Promise<Halt | ColimaHad> {
  const unchanged = { restarted: false } as const;
  if (run.platform !== "darwin") return unchanged;
  const { fit } = await setupFitRead(run.ports, "docker");
  const told = setupFitStopOf(fit);
  if (told !== undefined) return halt(told);
  if (fit.fit !== "Colima") return unchanged;
  const had: ColimaHad =
    fit.vm === "Running"
      ? {
          restarted: true,
          inUseMib: await setupEngineInUseRead(run.ports, "docker"),
        }
      : unchanged;
  for (const command of fit.commands) {
    const act = command[1] === "stop" ? "ColimaStop" : "ColimaStart";
    const acted = await setupActed(run, act, command);
    if (halted(acted)) return acted;
    run.notes.push({ note: "ColimaRan", command: setupCommandLine(command) });
  }
  const after = await setupFitRead(run.ports, "docker");
  const colima = after.mac?.colima;
  const vm = colima?.colima === "Vm" ? colima.vm : undefined;
  run.notes.push({
    note: "ColimaVm",
    memoryMib: vm?.memoryMib,
    amd64: vm?.amd64,
  });
  const still = setupFitStopOf(after.fit);
  if (still !== undefined) return halt(still);
  return after.fit.fit === "Colima"
    ? halt({
        stop: "ColimaShort",
        memoryMib: vm?.memoryMib,
        amd64: vm?.amd64,
      })
    : had;
}

/**
 * The file the person named as their Claude credential, copied to where the
 * runner keeps one of its kind where the machine has no runner settings and
 * no credential, the run going no further, so what `runner` would put here
 * is said before it is put and the settings it then writes name the copy.
 * Nothing is copied where a credential is in place, nor anything changed
 * where the file is not taken or settings name a credential that is not there.
 */
function setupCredentialPlaced(
  run: ProjectRun,
  given: SetupCredentialGiven,
): SetupRunnerEnded | Halt {
  const { ports, places, notes, offered } = run;
  const guide = offered.guideAddress;
  const settings = setupSettingsRead(ports, places);
  if (settings.settings === "Unread")
    return halt({ stop: "SettingsUnread", path: places.settings, guide });
  const held: SetupClaudeCredential =
    settings.settings === "Read"
      ? settings.credential
      : setupCredentialUnset(ports, places);
  if (ports.disk.kind(held.path) === "File") {
    notes.push({ note: "Login", credential: held });
    return { ended: "Credentialed" };
  }
  if (settings.settings === "Read")
    return halt({ stop: "LoginMissing", credential: held, guide });
  const path = setupCredentialPath(ports.surroundings, given.path);
  const read = setupCredentialRead(ports, { kind: given.kind, path });
  if (read.read === "Refused")
    return halt({ stop: "CredentialRefused", kind: given.kind, why: read.why });
  run.secrets.push(read.text.trim());
  const credential = {
    kind: given.kind,
    path: given.kind === "Subscription" ? places.login : places.apiKey,
  };
  const put = setupCredentialPut(run, credential.path, read.text);
  if (halted(put)) return put;
  notes.push({ note: "CredentialPlaced", credential });
  return { ended: "Credentialed" };
}

/** Puts a credential's text at `path`, readable only by the person, with the directories above it. */
function setupCredentialPut(
  run: Run,
  path: string,
  text: string,
): Halt | undefined {
  try {
    run.ports.disk.make(path, text);
  } catch (failure: unknown) {
    if (!(failure instanceof SetupMachineError)) throw failure;
    return halt({ stop: "Unwritten", path });
  }
  return undefined;
}

async function setupWalked(run: ProjectRun): Promise<SetupRunnerEnded | Halt> {
  const project = await setupProjectAsked(run);
  if (halted(project)) return project;
  const asked = await setupChatsAsked(run);
  if (halted(asked)) return asked;
  const { chats } = asked;
  if (setupHosted(project.route)) return setupHostedWalked(run, chats);
  const personal = await setupPersonalAsked(run);
  if (halted(personal)) return personal;
  if (run.credential !== undefined)
    return setupCredentialPlaced(run, run.credential);
  const colima = await setupColimaHad(run);
  if (halted(colima)) return colima;
  const leasts = setupPackageLeasts[run.platform];
  const machine = await setupMachineProbed(
    run,
    chats ? leasts.chat : leasts.runner,
  );
  if (halted(machine)) return machine;
  const packaged = await setupMachineShared(run, machine);
  if (halted(packaged)) return packaged;
  const done = await setupPersonalDone(run, packaged, personal);
  if (halted(done)) return done;
  const served = await setupServed(run);
  if (halted(served)) return served;
  const seen = await setupWaited(
    run,
    done.unit,
    () => setupPersonalLooked(run, done.client),
    (last, pid) => ({
      stop: "NotLive",
      waitedSecs: run.waitSecs,
      registered: last.listed,
      pid,
    }),
  );
  if (halted(seen)) return seen;
  run.notes.push({ note: "ProjectLive" });
  return chats
    ? setupChatWalked(
        run,
        machine,
        packaged,
        { of: "Runner", pooled: true },
        colima,
      )
    : { ended: "Live" };
}

/** A run as it is begun, under the sign-in `session` it entered. */
function setupRunMade(
  ports: SetupPorts,
  installs: boolean,
  tenant: string,
  writes: readonly string[],
  asked: { readonly waitSecs: number },
  livePollMs: number,
  enter: () => Promise<SetupRunnerEntered>,
  session: SetupRunnerSession,
): Run {
  const platform = setupPlatformOf(ports.surroundings);
  return {
    ports,
    platform,
    offered: runnerPackages[platform],
    installs,
    tenant,
    writes,
    waitSecs: asked.waitSecs,
    livePollMs,
    places: setupRunnerPlaces(ports.surroundings),
    notes: [],
    secrets: [session.bearer],
    enter,
    session,
  };
}

/** What a run's report says of how it ended, for the project or the workspace `at`. */
function setupRunSaid(
  at: SetupRunnerAt,
  session: Pick<SetupRunnerSession, "site" | "login">,
  notes: readonly SetupRunnerNote[],
  ended: SetupRunnerEnded,
): SetupReport {
  const { site, login } = session;
  return { report: "Runner", site, login, ...at, notes, ended };
}

/** A walk's end as a run's report, with whatever the walk found and did before it, also where what ended it is a sign-in the site stopped taking part-way. */
function setupRunReported(
  run: Run,
  at: SetupRunnerAt,
  ended: SetupRunnerEnded | Halt,
): SetupReport {
  if ("reported" in ended)
    return {
      report: "RunnerOut",
      ...at,
      notes: run.notes,
      out: ended.reported,
    };
  return setupRunSaid(
    at,
    run.session,
    run.notes,
    "halt" in ended ? { ended: "Stopped", stop: ended.halt } : ended,
  );
}

/** A walk's end, with what the person keeps running for it on a Mac said where it ended with what it set up live: Colima, which no service of the runner's starts. */
function setupDoneNoted(
  run: Run,
  ended: SetupRunnerEnded | Halt,
): SetupRunnerEnded | Halt {
  if (run.platform === "darwin" && !halted(ended) && ended.ended === "Live")
    run.notes.push({
      note: "Colima",
      start: setupCommandLine(setupColimaAtLogin),
    });
  return ended;
}

/** One run of `runner`, to its report. */
export async function setupRunner(
  ports: SetupPorts,
  asked: SetupRunnerAsked,
  enter: () => Promise<SetupRunnerEntered>,
  livePollMs: number,
): Promise<SetupReport> {
  const { workspace, project } = asked;
  const unnamed: SetupRunnerAt = { workspace, project };
  const entered = await enter();
  if (entered.entered === "Out") return entered.report;
  const at = setupRunnerAtNamed(unnamed, entered.session);
  const partition = { tenant: workspace, project };
  const chatHost = asked.chatHost === "yes";
  const run: ProjectRun = {
    ...setupRunMade(
      ports,
      false,
      workspace,
      setupRunnerWrites(partition, chatHost),
      asked,
      livePollMs,
      enter,
      entered.session,
    ),
    partition,
    chatHost,
    credential: asked.credential,
  };
  return setupRunReported(run, at, setupDoneNoted(run, await setupWalked(run)));
}

/** One run of `chat-host`, to its report. */
export async function setupChatHost(
  ports: SetupPorts,
  asked: SetupChatHostAsked,
  enter: () => Promise<SetupRunnerEntered>,
  livePollMs: number,
): Promise<SetupReport> {
  const { workspace } = asked;
  const unnamed: SetupRunnerAt = { workspace, project: undefined };
  const entered = await enter();
  if (entered.entered === "Out") return entered.report;
  const at = setupRunnerAtNamed(unnamed, entered.session);
  const run = setupRunMade(
    ports,
    true,
    workspace,
    setupChatHostWrites(workspace),
    asked,
    livePollMs,
    enter,
    entered.session,
  );
  const of: ChatOf = { of: "ChatHost", replace: asked.replace };
  return setupRunReported(
    run,
    at,
    setupDoneNoted(run, await setupChatAlone(run, of)),
  );
}
