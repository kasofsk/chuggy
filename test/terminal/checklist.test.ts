/**
 * The bare setup program printing its checklist, as a process, against a
 * stand-in installation whose site a case sets.
 *
 * These are the cases only real HTTP and real processes can make: the reads
 * sent to a site at each state of setup and answered over the wire, the
 * commands the program prints split by a real shell and run again, and every
 * request the site was sent kept with its method, so a bare run is seen to
 * have sent nothing but reads. The folder's remote, asked of a real git, is
 * `test/terminal/checklistRemote.test.ts`'s. The words a step is said in are
 * the table the console's own suites check. A home here is a machine with no
 * service manager, so at the runner's step the program says a runner cannot
 * be put on it and names the page; what it says and does where one can is the
 * runner suites'.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

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
  setupSiteBootstrap,
  setupSiteOpened,
  setupSiteProject,
  setupSiteRepositoryAddress,
  setupSiteStages,
  setupSiteTwo,
} from "../../ui/chuggy-ui/test/setupSite.ts";
import type {
  SetupSite,
  SetupSiteRead,
} from "../../ui/chuggy-ui/test/setupSite.ts";

import { browsed, dialect, program } from "./program.ts";
import type { Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";
import { read, ruled, said, signed } from "./checklistSigned.ts";

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

test("a site set up one thing further at a time, from nothing to a landed first ticket, is printed as it stands at each, with an address of the site's to go to wherever a page is what mends it, and no command but this one again", async () => {
  const session = await signed();
  for (const stage of setupSiteStages) {
    const done = await read(session, setupSiteAt(stage));
    assert.equal(done.code, 0, stage);
    assert.deepEqual(steps(done), saidStages[stage], stage);
    assert.equal(done.lines.at(-1), "next: stop", stage);
    const [tell = ""] = said(done, "tell");
    assert.equal(
      tell.includes(`${session.installation.site}/`),
      stage !== "Offline",
      tell,
    );
    if (stage === "Landed") assert.deepEqual(said(done, "rule"), []);
    else assert.deepEqual(await ruled(done), [], stage);
  }
});

test("where the repository holds only the bootstrap, a run set up to a done ticket whose pull request is still to merge closes on that pull request, having read the done ticket's landings, and a run where it holds its own reads none and closes as it did", async () => {
  const session = await signed();
  const { installation } = session;
  const url = "https://github.com/acme-org/widgets/pull/2";
  const world = (): SetupSite => {
    const landed = setupSiteAt("Landed");
    landed.projects[0]?.landings.set(1, [setupSiteOpened(url)]);
    return landed;
  };
  const closing = (merge: string) =>
    `chuggy is set up for acme/widgets: ticket 1 is done.${merge} The next ticket is made at ${installation.site}/acme/widgets/tickets/new.`;
  const landings = `GET ${installation.site}/api/v1/tenants/acme/projects/widgets/tickets/1/landings`;
  const bootstrapped = await read(session, setupSiteBootstrap(world()));
  assert.equal(bootstrapped.code, 0, bootstrapped.stdout);
  assert.deepEqual(steps(bootstrapped), saidStages.Landed);
  assert.deepEqual(said(bootstrapped, "tell"), [
    closing(
      ` Its pull request, ${url}, holds the repository's own configuration: merge it on GitHub so later tickets run on that configuration rather than each writing it again.`,
    ),
  ]);
  assert.deepEqual(said(bootstrapped, "rule"), []);
  assert.equal(bootstrapped.lines.at(-1), "next: stop");
  assert.ok(
    installation.asked.includes(landings),
    installation.asked.join("\n"),
  );
  installation.asked.length = 0;
  const own = await read(session, world());
  assert.equal(own.code, 0, own.stdout);
  assert.deepEqual(said(own, "tell"), [closing("")]);
  assert.ok(!installation.asked.includes(landings));
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

test("across every state of setup, a choice asked and a choice named, a bare run of a sign-in the site takes sends the site nothing but reads and the issuer one renewal", async () => {
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

test("a bare run of a sign-in the site refuses sends the site its one read twice and nothing else, and the issuer a second renewal and then the revocation of the token it was last handed, which is forgotten", async () => {
  const session = await signed();
  const { installation, machine } = session;
  installation.admits = false;
  const done = await machine.run([]);
  dialect(done, done.stdout);
  assert.equal(done.code, 1, done.stdout);
  assert.deepEqual(done.lines, [
    `site: ${installation.site}, not signed in`,
    "found: the site refused the remembered sign-in, so it was forgotten",
    `next: node ${program} sign-in`,
  ]);
  const requests = installation.asked.filter((asked) =>
    /^[A-Z]+ http/u.test(asked),
  );
  const workspaces = `GET ${installation.site}/access/v1/workspaces`;
  const renewal = `POST ${installation.issuer}/oauth2/token`;
  assert.deepEqual(requests, [
    `GET ${installation.site}/config.json`,
    `GET ${installation.issuer}/.well-known/openid-configuration`,
    renewal,
    workspaces,
    renewal,
    workspaces,
    `POST ${installation.issuer}/oauth2/revoke`,
  ]);
  assert.deepEqual(installation.grants.slice(1), [
    "refresh_token granted",
    "refresh_token granted",
  ]);
  assert.deepEqual(installation.revocations, [
    "client_id token token_type_hint: the renewal",
  ]);
  assert.equal(installation.renewal(), undefined);
  assert.equal(
    machine.file("session.json"),
    JSON.stringify({ site: installation.site }),
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

test("each list cut short leaves its step not read where what was sent does not settle it, and is never read as all there is: no name is taken from a list of projects that did not end, and a project named in full is read without one", async () => {
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
  const half = await read(session, partial, ["--project", "widgets"]);
  assert.deepEqual(said(half, "step"), []);
  assert.deepEqual(said(half, "ask"), [
    "Which workspace is this for: acme? The site sent only part of the list, so the one meant may not be named here. Pass the name as --workspace.",
  ]);
  const named = await read(session, partial, [...(await ruled(half)), "acme"]);
  assert.deepEqual(steps(named), saidStages.Landed);
});
