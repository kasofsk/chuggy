/**
 * The folder's remote, as the bare setup program asks a real git for it and
 * proposes a project from it, run as `test/terminal/checklist.test.ts` runs the
 * program: a git that answers, fails, answers too late or with too much,
 * outlasts its wait, or cannot be started at all.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  setupRemoteBytesMax,
  setupRemoteWaitMs,
} from "../../ui/chuggy-ui/app/core/setupRemote.ts";
import {
  setupSiteRepositoryAddress,
  setupSiteTwo,
} from "../../ui/chuggy-ui/test/setupSite.ts";

import { ended, eventually, gone } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import { read, ruled, said, signed } from "./checklistSigned.ts";

const credential = "ghp_ch3cklistRemoteNeverPrinted";

test("the folder's remote proposes the one project it is added to and says so, proposes none where it is added to none or to two, and is read as no remote outside a checkout and with no git to ask", async () => {
  const session = await signed();
  const { machine } = session;
  const asks = (done: Ran) => [said(done, "found"), said(done, "ask").length];
  const proposed =
    "this folder's remote github.com/acme-org/widgets is added to acme/gadgets and to no other project of acme the site shows you, so this checklist is of acme/gadgets: proposed and not chosen, and --workspace with --project names another";

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
    "this folder's remote github.com/acme-org/widgets is added to more than one project of acme the site shows you (acme/widgets, acme/gadgets), so it proposes none",
  ]);

  await machine.checkout("git@github.com:acme-org/elsewhere.git");
  assert.deepEqual(asks(await read(session, setupSiteTwo())), [
    [
      "this folder's remote github.com/acme-org/elsewhere is added to no project of acme the site shows you, so it proposes none",
    ],
    1,
  ]);
  assert.ok(!machine.written.join("\n").includes(credential));
  assert.ok(!machine.written.join("\n").includes("deploy"));
});

/** Longer than the harness lets any run last, so a run that waited the git out is one the harness ends as a failure. */
const sleepSecs = 600;

/** Whether a process can still run something, which one that ended and that nothing has collected cannot. */
function running(pid: number): boolean {
  return !gone(pid);
}

/** A path for one run on which `git` is a script of the case's own, answering as `body` says. */
function gitAnswering(machine: Home, name: string, body: string): string {
  const directory = join(machine.beside, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "git"), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
  return `${directory}:${machine.bin}`;
}

/** A script's last line that writes nothing and stays for `secs`, as the program this suite runs under and so by no name a run would have to find. */
function staying(secs: number): string {
  return `exec '${process.execPath}' -e 'setTimeout(() => undefined, ${String(secs * 1_000)})'`;
}

test("a git that fails, answers too late or answers with more than an address is given up on and read as no remote", async () => {
  const session = await signed();
  const answer = `printf '%s' ${setupSiteRepositoryAddress}`;
  const lateMs = setupRemoteWaitMs + 3_000;
  const node = `exec '${process.execPath}' -e`;
  const late = `${node} 'setTimeout(() => process.stdout.write(process.argv[1]), ${String(lateMs)})' ${setupSiteRepositoryAddress}`;
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
      `${answer}\n${node} 'process.stdout.write("/".repeat(${String(setupRemoteBytesMax)}))'`,
    ),
    0,
  );
  assert.equal(await proposed("late", late), 0);
});

test("a git still running when its wait runs out is ended by the run, which ends then and not when the git would have", async () => {
  const session = await signed();
  const { machine } = session;
  const noted = join(machine.beside, "git.pid");
  const path = gitAnswering(
    machine,
    "sleeping",
    `echo $$ > '${noted}'\n${staying(sleepSecs)}`,
  );
  const started = Date.now();
  try {
    const done = await read(session, setupSiteTwo(), [], { PATH: path });
    assert.deepEqual(said(done, "found"), []);
    assert.ok(Date.now() - started >= setupRemoteWaitMs, done.stdout);
    const pid = Number(readFileSync(noted, "utf8"));
    await eventually(() => (running(pid) ? undefined : true));
  } finally {
    if (existsSync(noted)) ended(Number(readFileSync(noted, "utf8")));
  }
});

test("a git the system will not start at all is no remote and no failure", async () => {
  const session = await signed();
  const directory = join(session.machine.beside, "looping");
  mkdirSync(directory);
  symlinkSync(join(directory, "git"), join(directory, "git"));
  const path = `${directory}:${session.machine.bin}`;
  const done = await read(session, setupSiteTwo(), [], { PATH: path });
  assert.equal(done.code, 0, done.stdout);
  assert.deepEqual(said(done, "found"), []);
  assert.equal(said(done, "ask").length, 1, done.stdout);
});
