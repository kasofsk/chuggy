/**
 * The bare setup program printing its checklist, as a process, against a
 * stand-in installation whose site a case sets.
 *
 * These are the cases only real HTTP and real processes can make: the reads
 * sent to a site at each state of setup and answered over the wire, the
 * folder's remote asked of a real git, the commands the program prints split
 * by a real shell and run again, and every request the site was sent kept
 * with its method, so a bare run is seen to have sent nothing but reads. The
 * words a step is said in are the table the console's own suites check.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  setupRemoteBytesMax,
  setupRemoteWaitMs,
} from "../../ui/chuggy-ui/app/core/setupRemote.ts";
import { setupSteps } from "../../ui/chuggy-ui/app/core/setupReport.ts";
import {
  saidFailures,
  saidFated,
  saidLandingSite,
  saidMember,
  saidMemberSite,
  saidStages,
  saidViewer,
  saidViewerSite,
} from "../../ui/chuggy-ui/test/setupSaid.ts";
import {
  setupSiteAt,
  setupSiteProject,
  setupSiteRepositoryAddress,
  setupSiteStages,
  setupSiteTwo,
} from "../../ui/chuggy-ui/test/setupSite.ts";
import type {
  SetupSite,
  SetupSiteRead,
} from "../../ui/chuggy-ui/test/setupSite.ts";
import {
  browsed,
  dialect,
  making,
  program,
  shellWords,
  signedIn,
} from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

interface Signed {
  readonly installation: StandIn;
  readonly machine: Home;
}

/** A machine signed in to a stand-in installation of its own, with nothing yet kept of what was asked. */
async function signed(): Promise<Signed> {
  const installation = await made.installation();
  const machine = made.machine();
  const done = await signedIn(installation, machine);
  assert.equal(done.code, 0, done.stdout);
  installation.asked.length = 0;
  return { installation, machine };
}

/** One run against the site as `world` holds it, bare unless `argv` says more, and a report in the dialect whatever it found. */
async function read(
  session: Signed,
  world: SetupSite,
  argv: readonly string[] = [],
  environment?: Readonly<Record<string, string>>,
): Promise<Ran> {
  session.installation.world = world;
  const done = await session.machine.run(argv, environment);
  dialect(done, done.stdout);
  assert.equal(
    done.lines[0],
    `site: ${session.installation.site}, signed in`,
    done.stdout,
  );
  return done;
}

const stepLine = /^step: (\w+) +(\w+)(?: +(\S.*))?$/u;

/** The steps a run printed, every one of them and in their order, each as how it stands and the words beside it. */
function steps(done: Ran): readonly (readonly [string, string])[] {
  const printed = done.lines.flatMap((text) => {
    const [, step = "", state = "", detail = ""] = stepLine.exec(text) ?? [];
    return step === "" ? [] : [[step, state, detail] as const];
  });
  assert.deepEqual(
    printed.map(([step]) => step),
    setupSteps,
    done.stdout,
  );
  return printed.map(([, state, detail]) => [state, detail]);
}

/** The lines a run printed under `word`, without the word. */
function said(done: Ran, word: string): readonly string[] {
  return done.lines
    .filter((text) => text.startsWith(`${word}: `))
    .map((text) => text.slice(word.length + 2));
}

const ruleEnd =
  / with the person's answer after it,| only (?:once|if) the person /u;

/**
 * The arguments of the command a run's rule names, as a shell makes words of
 * it. The command is this program run again, so what follows the program is
 * what the next run is given.
 */
async function ruled(done: Ran): Promise<readonly string[]> {
  const [rule = ""] = said(done, "rule");
  assert.match(rule, ruleEnd, done.stdout);
  const command = rule.slice("Run ".length, rule.search(ruleEnd));
  const [runner, script, ...argv] = await shellWords(command);
  assert.deepEqual([runner, script], ["node", program], done.stdout);
  return argv;
}

test("a site set up one thing further at a time, from nothing to a landed first ticket, is printed as it stands at each, with an address of the site's to go to and no command but this one again", async () => {
  const session = await signed();
  for (const stage of setupSiteStages) {
    const done = await read(session, setupSiteAt(stage));
    assert.equal(done.code, 0, stage);
    assert.deepEqual(steps(done), saidStages[stage], stage);
    assert.equal(done.lines.at(-1), "next: stop", stage);
    const [tell = ""] = said(done, "tell");
    assert.ok(tell.includes(`${session.installation.site}/`), tell);
    if (stage === "Landed") assert.deepEqual(said(done, "rule"), []);
    else assert.deepEqual(await ruled(done), [], stage);
  }
});

/** Every request either server was sent that is not a read, as its method and address. */
function writes(installation: StandIn): readonly string[] {
  return installation.asked.filter(
    (asked) => /^[A-Z]+ http/u.test(asked) && !asked.startsWith("GET "),
  );
}

/** A site with two workspaces, the second holding two projects, each named as awkwardly as a shell allows. */
function awkward(): SetupSite {
  const world = setupSiteAt("Landed");
  world.tenants.push({
    tenant: "two words",
    roles: ["Admin"],
    administer: true,
  });
  world.projects.push(
    setupSiteProject("two words", "it's --site"),
    setupSiteProject("two words", "$HOME;`id`"),
  );
  return world;
}

test("across every state of setup, a choice asked and a choice named, a bare run sends the site nothing but reads, and the one request that is not a read is the renewal the issuer is sent", async () => {
  const session = await signed();
  const { installation } = session;
  await session.machine.checkout(setupSiteRepositoryAddress);
  const worlds = [
    ...setupSiteStages.map(setupSiteAt),
    saidLandingSite(),
    saidMemberSite(),
    setupSiteTwo(),
    awkward(),
  ];
  for (const world of worlds) await read(session, world);
  const named = ["--workspace", "two words", "--project", "it's --site"];
  await read(session, awkward(), named);
  const runs = worlds.length + 1;
  assert.deepEqual(
    writes(installation),
    Array.from(
      { length: runs },
      () => `POST ${installation.issuer}/oauth2/token`,
    ),
  );
  const reads = installation.asked.filter((asked) =>
    asked.startsWith(`GET ${installation.site}/`),
  );
  assert.ok(reads.length > runs, String(reads.length));
  assert.deepEqual(
    reads.filter((asked) => /token|pool|registration/iu.test(asked)),
    [],
  );
  await browsed(`${installation.site}/api/v1/projects`, "POST");
  assert.equal(
    writes(installation).at(-1),
    `POST ${installation.site}/api/v1/projects`,
  );
});

test("with more than one workspace the person is asked which and then which project, and each command printed, split by a shell and run with her answer, carries the names on however they are spelled", async () => {
  const session = await signed();
  const asked = await read(session, awkward());
  assert.equal(asked.code, 0);
  assert.deepEqual(said(asked, "ask"), [
    "Which workspace is this for: acme or two words? Pass the name as --workspace.",
  ]);
  assert.deepEqual(said(asked, "step"), []);
  assert.equal(asked.lines.at(-1), "next: stop");
  const workspace = [...(await ruled(asked)), "two words"];
  assert.deepEqual(workspace, ["--workspace", "two words"]);

  const within = await read(session, awkward(), workspace);
  assert.deepEqual(said(within, "ask"), [
    "Which project of two words is this for: $HOME;`id` or it's --site? Pass the name as --project.",
  ]);
  for (const project of ["it's --site", "$HOME;`id`"]) {
    const named = [...(await ruled(within)), project];
    assert.deepEqual(named, ["--workspace", "two words", "--project", project]);
    const first = await read(session, awkward(), named);
    assert.deepEqual(steps(first).slice(0, 2), [
      ["done", "two words"],
      ["waiting", `two words/${project} has no North Star yet`],
    ]);
    assert.deepEqual(await ruled(first), named);
    const again = await read(session, awkward(), await ruled(first));
    assert.equal(again.stdout, first.stdout);
  }
});

test("a member who administers nothing, and a viewer of one project, are each shown what they wait on and are not shown, as states and not failures, and are handed nothing to run", async () => {
  const session = await signed();
  for (const [world, column] of [
    [saidMemberSite(), saidMember],
    [saidViewerSite(), saidViewer],
  ] as const) {
    const done = await read(session, world);
    assert.equal(done.code, 0, done.stdout);
    assert.deepEqual(steps(done), column);
    assert.match(said(done, "tell")[0] ?? "", / an admin of acme /u);
    assert.equal(done.lines.at(-1), "next: stop");
    assert.deepEqual(await ruled(done), []);
  }
});

test("each read failing, refused, unreadable or answered as to a stranger leaves its own step not read and no other said differently, is a failure unless it was refused, and forgets nothing", async () => {
  const session = await signed();
  for (const [fated, fate] of saidFailures) {
    const world = saidLandingSite();
    world.fates.set(fated, fate);
    const done = await read(session, world);
    assert.deepEqual(steps(done), saidFated(fated, fate), `${fated} ${fate}`);
    assert.equal(done.code, fate === "Refused" ? 0 : 1, `${fated} ${fate}`);
    assert.equal(done.lines.at(-1), "next: stop");
    if (fate === "Garbled")
      assert.deepEqual(said(done, "rule"), [
        `Run curl -fsS ${session.installation.site}/chuggy-setup.mjs -o ${program} && node ${program} only if the person asks to fetch chuggy setup again.`,
      ]);
    else assert.deepEqual(await ruled(done), [], `${fated} ${fate}`);
  }
  const healthy = await read(session, saidLandingSite());
  assert.equal(healthy.code, 0, healthy.stdout);
  assert.deepEqual(
    session.installation.grants.filter((grant) => !grant.endsWith(" granted")),
    [],
  );
});

const cuts: readonly (readonly [
  SetupSiteRead,
  () => SetupSite,
  number,
  string,
])[] = [
  ["installations", () => setupSiteAt("Portal"), 2, "its GitHub accounts were"],
  ["repositories", () => setupSiteAt("Added"), 3, "its repositories were"],
  ["moving", saidLandingSite, 5, "its tickets were"],
  ["landings", saidLandingSite, 5, "a ticket's landings were"],
];

test("each list cut short leaves its step not read where what was sent does not settle it, and is never read as all there is", async () => {
  const session = await signed();
  for (const [cut, site, at, subject] of cuts) {
    const world = site();
    world.fates.set(cut, "Cut");
    const done = await read(session, world);
    assert.deepEqual(
      steps(done)[at],
      ["unread", `${subject} sent only in part`],
      cut,
    );
    assert.equal(done.code, 0, cut);
    assert.match(said(done, "tell")[0] ?? "", / sent only part of /u, cut);
  }
  const partial = setupSiteAt("Landed");
  partial.fates.set("inventory", "Cut");
  const unchosen = await read(session, partial);
  assert.deepEqual(said(unchosen, "step"), []);
  const named = await read(session, partial, ["--project", "widgets"]);
  assert.deepEqual(steps(named), saidStages.Landed);
});

const credential = "ghp_ch3cklistRemoteNeverPrinted";

test("the folder's remote proposes the one project it is added to and says so, proposes none where it is added to none or to two, and is read as no remote outside a checkout and with no git to ask", async () => {
  const session = await signed();
  const { machine } = session;
  const asks = (done: Ran) => [said(done, "found"), said(done, "ask").length];
  const proposed =
    "this folder's remote github.com/acme-org/widgets is added to acme/gadgets and to no other project of yours, so this checklist is of acme/gadgets: proposed and not chosen, and --workspace with --project names another";

  assert.deepEqual(asks(await read(session, setupSiteTwo())), [[], 1]);
  await machine.checkout();
  assert.deepEqual(asks(await read(session, setupSiteTwo())), [[], 1]);

  await machine.checkout(
    `https://deploy:${credential}@github.com/acme-org/widgets.git`,
  );
  const one = await read(session, setupSiteTwo());
  assert.deepEqual(asks(one), [[proposed], 0]);
  assert.deepEqual(await ruled(one), [
    "--workspace",
    "acme",
    "--project",
    "gadgets",
  ]);

  const empty = join(machine.beside, "no-programs");
  mkdirSync(empty);
  const gitless = await read(session, setupSiteTwo(), [], { PATH: empty });
  assert.deepEqual(asks(gitless), [[], 1]);

  const both = setupSiteTwo();
  both.projects[0]?.repositories.push({
    repository: setupSiteRepositoryAddress,
    configured: true,
  });
  const two = await read(session, both);
  assert.equal(said(two, "ask").length, 1, two.stdout);
  assert.deepEqual(said(two, "found"), [
    "this folder's remote github.com/acme-org/widgets is added to more than one of your projects (acme/widgets, acme/gadgets), so it proposes none",
  ]);

  await machine.checkout("git@github.com:acme-org/elsewhere.git");
  assert.deepEqual(asks(await read(session, setupSiteTwo())), [
    [
      "this folder's remote github.com/acme-org/elsewhere is added to none of your projects, so it proposes none",
    ],
    1,
  ]);
  assert.ok(!machine.written.join("\n").includes(credential));
  assert.ok(!machine.written.join("\n").includes("deploy"));
});

/** A path for one run on which `git` is a script of the case's own, answering as `body` says. */
function gitAnswering(machine: Home, name: string, body: string): string {
  const directory = join(machine.beside, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "git"), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
  return `${directory}:${process.env["PATH"] ?? ""}`;
}

test("a git that fails, answers too late or answers with more than an address is given up on and read as no remote", async () => {
  const session = await signed();
  const answer = `printf '%s' ${setupSiteRepositoryAddress}`;
  const lateMs = setupRemoteWaitMs + 3_000;
  const late = `exec '${process.execPath}' -e 'setTimeout(() => process.stdout.write(process.argv[1]), ${String(lateMs)})' ${setupSiteRepositoryAddress}`;
  const proposed = async (name: string, body: string): Promise<number> => {
    const path = gitAnswering(session.machine, name, body);
    const done = await read(session, setupSiteTwo(), [], { PATH: path });
    return said(done, "found").length;
  };
  assert.equal(await proposed("prompt", answer), 1);
  assert.equal(await proposed("failing", `${answer}\nexit 1`), 0);
  assert.equal(
    await proposed(
      "long",
      `${answer}\nhead -c ${String(setupRemoteBytesMax)} /dev/zero | tr '\\0' /`,
    ),
    0,
  );
  assert.equal(await proposed("late", late), 0);
});
