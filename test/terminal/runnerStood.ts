/**
 * What the `runner` suites stand up and read: a stand-in machine signed in to
 * a stand-in installation of its own, one run of the program there, and what
 * that run did and wrote. Each suite runs in a process of its own, so what is
 * kept here of the machines stood up is that suite's.
 */

import assert from "node:assert/strict";
import { join } from "node:path";

import { boxActOf } from "../../ui/chuggy-ui/test/setupRunnerBox.ts";
import { rosterLines } from "../../ui/chuggy-ui/test/setupRunnerRoster.ts";
import type { PlacementRoute } from "../../src/contract/rosters.ts";
import {
  setupSiteAt,
  setupSiteMember,
} from "../../ui/chuggy-ui/test/setupSite.ts";

import {
  machineAskers,
  machineLoginSecret,
  machineStoodIn,
} from "./machine.ts";
import type { Machine } from "./machine.ts";
import { machineNamePart } from "./machineShape.ts";
import { dialect, making, program, signedIn, userSaid } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

export interface Stood {
  readonly installation: StandIn;
  readonly home: Home;
  readonly machine: Machine;
}

/** Every machine the suite stood up, for its control to search. */
export const stoodAll: Stood[] = [];

/** `runner` as the rule of an offer that asks of no chat host names it. */
export const runnerAlone = [
  "runner",
  "--workspace",
  "acme",
  "--project",
  "widgets",
];
/** `runner` as a person who said yes to their chat host too runs it. */
export const runner = [...runnerAlone, "--chat-host", "yes"];
export const flags = "--workspace acme --project widgets";
export const personalFile = `acme.${machineNamePart(setupSiteMember)}.json`;
export const unit = `chuggy-linux-acme.${machineNamePart(setupSiteMember)}.service`;
/** The user a run takes itself for, by number: the one the runner package takes docker from. */
export const user = "1000";
export const mint =
  "program POST /api/v1/tenants/acme/personal-runner-registration-tokens";
export const redemption = "runner POST /api/v1/personal-runner-registrations";
/** The writes that let the person's runner take the project's work: the project given to it, and Preferred named as the project's owner fallback. */
export const serve = [
  "program PUT /api/v1/tenants/acme/personal-runner/projects/widgets",
  "program PUT /api/v1/tenants/acme/projects/widgets/owner-fallback",
];
export const chatFile = `acme.${machineNamePart(setupSiteMember)}.chat.host.json`;
export const chatUnit = `chuggy-linux-acme.${machineNamePart(setupSiteMember)}.chat.host.service`;
export const next = `next: node ${program} ${flags}`;
export const again = `rule: Run node ${program} runner ${flags} --chat-host yes only `;

export const mcp = ["mcp", "--workspace", "acme", "--project", "widgets"];

/** A machine a runner could be put on, signed in to an installation whose project is set up as far as a runner and whose chats run where `chats` says, with nothing yet kept of what was asked or run; where `served`, `mcp` has been run there, so the runner package is installed and the agent has chuggy's MCP server. */
export async function stood(
  chats: PlacementRoute = "InCluster",
  served = true,
): Promise<Stood> {
  const installation = await made.installation();
  const home = made.machine();
  const machine = machineStoodIn(home, installation);
  const done = await signedIn(installation, home);
  assert.equal(done.code, 0, done.stdout);
  installation.world = setupSiteAt("Configured");
  for (const project of installation.world.projects) project.threads = chats;
  if (served) {
    const installed = await home.run(mcp, { [userSaid]: user });
    assert.equal(installed.code, 0, installed.stdout);
  }
  installation.asked.length = 0;
  machine.forget();
  const on = { installation, home, machine };
  stoodAll.push(on);
  return on;
}

/** Everything the stand-ins handed out on this machine that nothing the program writes may hold. */
function secrets(on: Stood): readonly string[] {
  return [
    ...on.installation.world.secrets,
    ...on.installation.issued,
    machineLoginSecret,
  ];
}

/** The control: nothing the stand-ins handed out to any machine the suite stood up is in anything the program wrote there, and there was something handed out and written to search. */
export function stoodSearched(): void {
  const handed = stoodAll.flatMap((on) => on.installation.world.secrets);
  for (const kind of ["registration", "credential"])
    assert.ok(
      handed.some((secret) => secret.includes(kind)),
      kind,
    );
  for (const on of stoodAll) {
    const wrote = on.home.written.join("\n");
    assert.ok(wrote.length > 0);
    for (const secret of secrets(on)) {
      assert.ok(secret.length >= 16, secret);
      assert.ok(!wrote.includes(secret));
    }
  }
}

/** One run, which is in the dialect and holds no secret whatever it met. */
export async function ran(
  on: Stood,
  argv: readonly string[] = runner,
  environment?: Readonly<Record<string, string>>,
): Promise<Ran> {
  const done = await on.home.run(argv, { [userSaid]: user, ...environment });
  dialect(done, done.stdout);
  for (const secret of secrets(on))
    assert.ok(!done.stdout.includes(secret), done.stdout);
  return done;
}

export function lines(on: Stood, engine: "docker" | "podman" = "docker") {
  return rosterLines({
    command: join(on.machine.prefix, "bin", "chuggy-linux"),
    settings: on.machine.settings,
    login: on.machine.login,
    personal: join(on.machine.pools, personalFile),
    unit,
    chat: join(on.machine.pools, chatFile),
    chatUnit,
    engine,
  });
}

/** What each command run was for, in order, but for the ones that are no act of `runner`'s. */
export function acts(on: Stood): readonly string[] {
  return on.machine
    .calls()
    .flatMap((call) => boxActOf([call.name, ...call.argv]) ?? []);
}

/** The words each command of this name was run with. */
export function words(on: Stood, name: string): readonly (readonly string[])[] {
  return on.machine
    .calls()
    .filter((call) => call.name === name)
    .map((call) => call.argv);
}

/** No command run so far could have asked anyone for a password: each was given nothing to read, each led a session of its own, and none is a command that asks. */
export function unasked(on: Stood): void {
  const calls = on.machine.calls();
  assert.ok(calls.length > 0);
  for (const call of calls) {
    const said = JSON.stringify(call);
    assert.equal(call.stdin, "/dev/null", said);
    assert.ok(!machineAskers.some((asker) => asker === call.name), said);
    assert.ok(call.leads, said);
    if (call.argv.includes("enable-linger"))
      assert.equal(call.argv[0], "--no-ask-password", said);
  }
}

export const first = [
  "services",
  "docker",
  "register",
  "doctor",
  "service",
  "linger",
  "lingerOn",
  "linger",
  "enabled",
  "active",
  "reload",
  "start",
  "shown",
];

export const probes = [
  "services",
  "docker",
  "doctor",
  "linger",
  "enabled",
  "active",
];

/** What a run on a machine that has everything runs: its probes, and the package's `install-service`, which writes the unit again as it was. */
export const rerun = [...probes.slice(0, 3), "service", ...probes.slice(3)];

/** Forgets what was asked and run, so a case reads only what its next run did. */
export function cleared(on: Stood): void {
  on.machine.forget();
  on.installation.writes.length = 0;
}
