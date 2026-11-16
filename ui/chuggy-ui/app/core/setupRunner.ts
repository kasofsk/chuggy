/**
 * `runner`: a runner installed, registered and started on the machine the
 * program is run on, for one project, and said to be done only once the site
 * sees it live; then, where the person's chats in the project run on runners
 * and they said yes to it, the same machine made their chat host, which takes
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
  SessionPlacementResponse,
  WorkerPoolTokenResponse,
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
import { myRunnerShort } from "./myRunner.ts";
import { projectAbilityRefused } from "./projectAbilities.ts";
import { runnerPackages, runnerTokenLifetimeSecs } from "./runners.ts";
import type { RunnerKind, RunnerPackage } from "./runners.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";
import type { SessionRunnerShort } from "./sessionRunners.ts";
import { settingsRoutes } from "./settingsNav.ts";
import type { SetupAsked } from "./setupArguments.ts";
import { SetupMachineError, setupPlatformOf } from "./setupPorts.ts";
import type { SetupPlatform, SetupPorts } from "./setupPorts.ts";
import { setupGot, setupReadPorts } from "./setupReads.ts";
import type { SetupRead } from "./setupReads.ts";
import type { SetupReport } from "./setupReport.ts";
import {
  setupAgentDomain,
  setupAgentIs,
  setupChatClient,
  setupChatFiles,
  setupChildBytesMax,
  setupChatSized,
  setupChildFailed,
  setupColimaAtLogin,
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
  setupPoolFiles,
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
  setupUnitOf,
  setupUnitText,
} from "./setupRunnerMachine.ts";
import type {
  SetupFile,
  SetupPackageProbe,
  SetupPoolFile,
  SetupRunnerPlaces,
  SetupRunnerRoom,
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
  CheckChat: 120_000,
  ServiceChat: 60_000,
  Reload: 60_000,
  Start: 60_000,
  Restart: 60_000,
  ColimaStop: 120_000,
  ColimaStart: 600_000,
};

/** How often the site is asked again whether it sees a runner live. */
export const setupLivePollMs = 3_000;

/** A sign-in a run works under: the site, its API, and the bearer the run got while it held the lock. */
export interface SetupRunnerSession {
  readonly site: string;
  readonly api: ApiPorts;
  readonly bearer: string;
  /** The person's own workspaces, as the site answered them on signing in. */
  readonly workspaces: readonly AccessCallerTenant[];
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

/** A run of `runner`, for one project; `chatHost` where the person said yes to this machine as their chat host too. */
interface ProjectRun extends Run {
  readonly partition: PartitionIdentity;
  readonly chatHost: boolean;
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

/** Each write `runner` makes for a project, by its method and its address: the mint of a registration token for the project's runner, and for the person's chat host where `chat` says this machine is made it. */
export function setupRunnerWrites(
  partition: PartitionIdentity,
  chat: boolean,
): readonly string[] {
  const route = nativeHttpRoutes.workerPoolRegistrationTokens
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project));
  return [
    `POST ${route}`,
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

/** Where the person's chats in the project run, read before anything is touched: whether they run on a chat host, which is the person's, and the person said yes to this machine as it. */
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

/** Where the project's work runs, read before anything is touched: on the cluster, which needs no runner, or on runners this person may register one of. */
async function setupProjectAsked(
  run: ProjectRun,
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
      : { kind: "Subscription", path: places.login };
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
      setupSettingsText(run.platform, machine.engine, machine.credential.path),
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
 * no sessions for it: as many as the engine's memory has room for beside a
 * job, and one where it has room for none, each taking the memory the
 * settings name or the package's own, keeping every other key. Answers
 * whether it wrote them, which is whether a running chat host is now stale.
 */
async function setupChatSettingsHad(
  run: Run,
  machine: Machine,
): Promise<{ readonly written: boolean } | Halt> {
  const path = run.places.settings;
  const guide = run.offered.guideAddress;
  const held = setupSettingsHeld(run.ports, run.places);
  const chat = held === undefined ? undefined : setupSettingsChat(held);
  if (held === undefined || chat === undefined)
    return halt({ stop: "SettingsUnread", path, guide });
  if (chat.sessionsMax !== undefined) return { written: false };
  const engineMib = await setupEngineMemoryRead(run.ports, machine.engine);
  const { sessionsMax, sessionMemoryMib } = setupChatSized(engineMib, chat);
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

/** A registration of this machine, and whether this run made it. */
interface Registered<File extends SetupFile> {
  readonly file: File;
  readonly fresh: boolean;
}

type Pooled = Registered<SetupPoolFile>;

/** The pool file among those held whose pool the site lists, which is what makes a registration good; or that none is, where the site's list was whole. */
async function setupPoolGood(
  run: ProjectRun,
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

/** A registration token's mint, as a pool's or as the person's chat host's. */
type Mint = (
  ports: ApiPorts,
  asked: { readonly lifetimeSecs: number },
) => Promise<ApiResult<WorkerPoolTokenResponse>>;

/**
 * Mints a registration token by `mint`, as a pool's or as the person's chat
 * host's, and hands it to the package's `register` as one word of its
 * arguments and to nothing else, answering what `register` printed.
 */
async function setupTokenHanded(
  run: Run,
  command: string,
  kind: Exclude<RunnerKind, "Personal">,
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

async function setupRegistered(
  run: ProjectRun,
  command: string,
): Promise<Pooled | Halt> {
  const acted = await setupTokenHanded(run, command, "Pool", (ports, asked) =>
    apiMintWorkerPoolToken(ports, run.partition, asked),
  );
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

async function setupPoolHad(
  run: ProjectRun,
  command: string,
): Promise<Pooled | Halt> {
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
  return setupInactive(run, unit, undefined);
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
    return setupInactive(run, unit, undefined);
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
  return setupInactive(run, unit, undefined);
}

/** Whether a service is running now, as the platform's service manager says, and the one word it said of it. */
async function setupRunning(
  run: Run,
  unit: SetupUnit,
): Promise<{ readonly is: boolean; readonly said: string | undefined }> {
  if (run.platform === "linux")
    return setupUnitIs(run.ports, "is-active", unit);
  const domain = await setupAgentDomain(run.ports);
  return setupAgentIs(run.ports, domain, unit);
}

/** Asks the service manager whether the runner's service is running now, and answers the stop it is where it is not. */
async function setupInactive(
  run: Run,
  unit: SetupUnit,
  waitedSecs: number | undefined,
): Promise<Halt | undefined> {
  const now = await setupRunning(run, unit);
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
    await run.ports.sleepMs(run.livePollMs);
  }
}

/** The project's runner as the console's own decider says it stands on `route`: live, or why not. */
async function setupProjectLooked(
  run: ProjectRun,
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
  run: ProjectRun,
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
  return (await setupStarted(run, served, changed)) ?? served.unit;
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

/** Whether the workspace lets the person register a chat host; `work` is what the project's work has, which the stop says is set up, and nothing where the run is for the workspace alone. */
async function setupPermitted(
  run: Run,
  work: "Runner" | "Cluster" | undefined,
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
  return halt({
    stop: "PermitWithheld",
    people: `${run.session.site}${people}`,
    work,
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
): Promise<Hosting | Halt> {
  if (held !== undefined)
    run.notes.push({ note: "ChatHostGone", path: held.path });
  const work =
    of.of === "ChatHost" ? undefined : of.pooled ? "Runner" : "Cluster";
  const permitted = await setupPermitted(run, work);
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
  const client = setupChatClient(run.ports, file);
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
  const sized = await setupChatSettingsHad(run, machine);
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
  return setupChatWalked(run, machine, packaged, of);
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

/** On a Mac, Colima's VM given what a job needs where a yes can give it, or the stop of what only the person can mend; then what the VM has. */
async function setupColimaHad(run: Run): Promise<Halt | undefined> {
  if (run.platform !== "darwin") return undefined;
  const { fit } = await setupFitRead(run.ports, "docker");
  const told = setupFitStopOf(fit);
  if (told !== undefined) return halt(told);
  if (fit.fit !== "Colima") return undefined;
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
    : undefined;
}

async function setupWalked(run: ProjectRun): Promise<SetupRunnerEnded | Halt> {
  const project = await setupProjectAsked(run);
  if (halted(project)) return project;
  const asked = await setupChatsAsked(run);
  if (halted(asked)) return asked;
  const { chats } = asked;
  if (setupHosted(project.route)) return setupHostedWalked(run, chats);
  const leasts = setupPackageLeasts[run.platform];
  const least = chats ? leasts.chat : leasts.pool;
  const colima = await setupColimaHad(run);
  if (colima !== undefined) return colima;
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
    ? setupChatWalked(run, machine, packaged, { of: "Runner", pooled: true })
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
  site: string | undefined,
  notes: readonly SetupRunnerNote[],
  ended: SetupRunnerEnded,
): SetupReport {
  return { report: "Runner", site, ...at, notes, ended };
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
    run.session.site,
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
