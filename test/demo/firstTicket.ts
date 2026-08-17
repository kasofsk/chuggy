/**
 * The first real chuggy ticket, driven end to end through the machine this
 * repository is: the entrypoint is booted against the rig's fake Jobs API and
 * a bare remote seeded with this very repository's HEAD, the ticket is
 * authored and released through the desk over HTTP, the work task commits a
 * real change on its work branch, the evaluation task runs
 * `.chug/tasks/ci.sh` — the command evaluator, unchanged — in a real clone of
 * that branch, and the wrap-up merges the branch into the seeded repo's main.
 * It is a runnable script rather than a suite: a tracked `*.test.ts` runs
 * inside every ci.sh through check-source's unit stage, and this file runs
 * ci.sh itself, so a suite here would nest the gate run inside the gate run.
 * Run it with `npm run demo`. It prints the transcript and exits nonzero on
 * any deviation.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeKubernetesApi } from "../adapters/fakeKubernetesApi.ts";
import {
  rigArrive,
  rigEnv,
  rigFreePort,
  rigGet,
  rigGit,
  rigGrant,
  rigIdentity,
  rigJob,
  rigJournal,
  rigKill,
  rigOperator,
  rigPost,
  rigRunJob,
  rigServe,
  rigWorkers,
  type RigDesk,
  type RigGround,
  type RigRun,
} from "../entrypoint/rig.ts";

const demoRoot = join(import.meta.dirname, "..", "..");

function demoSay(fact: string): void {
  console.log(`demo: ${fact}`);
}

/** A bare remote seeded with this repository's committed HEAD as its main; the full destination refname is what lets a detached-HEAD checkout — a verifier pinning one commit — seed it too. */
function demoRemote(dir: string): string {
  const remote = join(dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", [
    "-C",
    demoRoot,
    "push",
    "-q",
    remote,
    "HEAD:refs/heads/main",
  ]);
  return remote;
}

/** The worker scripts, with every path they need written into them because the catalog's eval half carries no environment of its own. */
function demoScripts(
  dir: string,
  remote: string,
  evalLog: string,
): { readonly work: string; readonly evaluate: string } {
  const declare = rigWorkers(dir).declare;
  const work = join(dir, "work.sh");
  writeFileSync(
    work,
    [
      "#!/bin/sh",
      "set -eu",
      'work="$(mktemp -d)/work"',
      `git clone -q '${remote}' "$work"`,
      'cd "$work"',
      'git checkout -q -b "$CHUG_WORK_BRANCH"',
      "mkdir -p demo",
      "printf '%s\\n' 'the first ticket, driven end to end' \\",
      "  > demo/first-ticket.txt",
      "git add demo/first-ticket.txt",
      "git -c user.name=worker -c user.email=worker@example.test \\",
      '  commit -q -m "demo: the first ticket\'s change"',
      'git push -q origin "HEAD:$CHUG_WORK_BRANCH"',
      `exec /bin/sh '${declare}' \\`,
      '  "{\\"verdict\\":\\"VPass\\",\\"artifact\\":{\\"body\\":\\"BGitRef\\",\\"branch\\":\\"$CHUG_WORK_BRANCH\\"}}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const evaluate = join(dir, "evaluate.sh");
  writeFileSync(
    evaluate,
    [
      "#!/bin/sh",
      "set -eu",
      'clone="$(mktemp -d)/eval"',
      `git clone -q -b "$CHUG_WORK_BRANCH" '${remote}' "$clone"`,
      'cd "$clone"',
      `cp -cR '${join(demoRoot, "node_modules")}' node_modules 2>/dev/null \\`,
      `  || cp -R '${join(demoRoot, "node_modules")}' node_modules`,
      "verdict=VFail",
      `if CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh > '${evalLog}' 2>&1; then`,
      "  verdict=VPass",
      "fi",
      `exec /bin/sh '${declare}' \\`,
      '  "{\\"verdict\\":\\"$verdict\\",\\"artifact\\":{\\"body\\":\\"BNone\\"}}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { work, evaluate };
}

/** The one-type catalog the demo deployment runs: real work, and the tree's own gate sequencer as the evaluation. */
function demoCatalog(dir: string, remote: string, evalLog: string): string {
  const scripts = demoScripts(dir, remote, evalLog);
  const path = join(dir, "catalog.json");
  writeFileSync(
    path,
    JSON.stringify({
      demo: {
        work: { image: "local", command: ["/bin/sh", scripts.work], env: {} },
        eval: { image: "local", command: ["/bin/sh", scripts.evaluate] },
        resources: {
          requests: { cpu: "1", memory: "1Gi" },
          limits: { cpu: "4", memory: "4Gi" },
        },
        activeDeadlineSeconds: 3600,
        backoffLimit: 0,
      },
    }),
  );
  return path;
}

async function demoGround(
  dir: string,
  evalLog: string,
  closers: (() => Promise<void>)[],
): Promise<RigGround> {
  const fake = await fakeKubernetesApi();
  closers.push(() => fake.close());
  const identity = await rigIdentity();
  closers.push(() => identity.close());
  const port = await rigFreePort();
  const remote = demoRemote(dir);
  const secretsDir = join(dir, "secrets");
  mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "author.key"), "demo-material\n");
  const env = rigEnv({
    port,
    fakeBase: fake.base,
    identity,
    catalogPath: demoCatalog(dir, remote, evalLog),
    remote,
    secretsDir,
    scratchDir: join(dir, "scratch.git"),
  });
  return {
    dir,
    dbPath: join(dir, "chuggy.sqlite"),
    base: `http://127.0.0.1:${String(port)}`,
    remote,
    fake,
    identity,
    env,
  };
}

async function demoPhase(desk: RigDesk, ticket: number): Promise<string> {
  const view = await rigGet(desk, `/api/tickets/${String(ticket)}`);
  const held = view["ticket"] as { row: { phase: string } };
  return held.row.phase;
}

const demoPhaseTriesMax = 400;

async function demoUntilPhase(
  desk: RigDesk,
  ticket: number,
  phase: string,
): Promise<void> {
  for (let tries = 0; tries < demoPhaseTriesMax; tries++) {
    if ((await demoPhase(desk, ticket)) === phase) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`deviation: ticket ${String(ticket)} never reached ${phase}`);
}

/** Requires a worker's own exit clean, since a worker that could not even declare is a deviation. */
function demoRequireClean(
  what: string,
  ran: { readonly code: number; readonly output: string },
): void {
  if (ran.code !== 0) {
    throw new Error(`deviation: the ${what} worker exited: ${ran.output}`);
  }
}

async function demoDrive(g: RigGround, evalLog: string): Promise<void> {
  const desk = await rigOperator(g);
  await rigGrant(desk);
  const ticket = await rigArrive(desk, "demo", "WExclusive:1");
  demoSay(
    `ticket ${String(ticket)} authored; phase ${await demoPhase(desk, ticket)}`,
  );
  await rigPost(desk, `/api/tickets/${String(ticket)}/release`, {});
  demoSay(`released; phase ${await demoPhase(desk, ticket)}`);

  const branch = `chug/t${String(ticket)}/k1`;
  const worked = await rigRunJob(
    g.fake,
    await rigJob(g.fake, `chug-t${String(ticket)}-k1`),
  );
  demoRequireClean("work", worked);
  demoSay(
    `work committed and pushed ${branch}: ${rigGit(g.remote, "rev-parse", branch)}`,
  );
  await demoUntilPhase(desk, ticket, "PEvaluating");
  demoSay(`work passed; phase PEvaluating`);

  demoSay(
    `eval running .chug/tasks/ci.sh in a clone of ${branch}, with CHUG_CI_SHELL_SUITES=0`,
  );
  const evaluated = await rigRunJob(
    g.fake,
    await rigJob(g.fake, `chug-t${String(ticket)}-k2`),
  );
  demoRequireClean("eval", evaluated);
  const gateOutput = readFileSync(evalLog, "utf8");
  demoSay(`eval gate output tail:`);
  for (const line of gateOutput.trimEnd().split("\n").slice(-14)) {
    console.log(`  ${line}`);
  }
  if (!/^ci: all gates clean$/m.test(gateOutput)) {
    throw new Error(
      "deviation: the evaluation did not end in ci: all gates clean",
    );
  }

  await demoUntilPhase(desk, ticket, "PDone");
  const merged = rigGit(g.remote, "rev-parse", "main");
  demoSay(`wrap-up merged ${branch} into main: ${merged}`);
  demoSay(
    `merge parents: ${rigGit(g.remote, "log", "-1", "--format=%P", "main")}`,
  );
  demoSay(
    `main now holds: ${rigGit(g.remote, "show", "main:demo/first-ticket.txt")}`,
  );
  demoSay(
    `phase ${await demoPhase(desk, ticket)}; journal ${String(rigJournal(g.dbPath).length)} decision(s), legal`,
  );
}

async function demoMain(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-demo-"));
  const evalLog = join(dir, "eval-ci.log");
  /** Each listener registers its closer the moment it opens, so a deviation anywhere — the ground's own assembly included — closes them all and the process exits instead of holding the event loop. */
  const closers: (() => Promise<void>)[] = [];
  let run: RigRun | undefined;
  try {
    const g = await demoGround(dir, evalLog, closers);
    demoSay(
      `remote seeded from ${demoRoot} at ${rigGit(g.remote, "rev-parse", "main")}`,
    );
    demoSay(
      `eval clones reuse ${join(demoRoot, "node_modules")} by copy (cp -cR, cp -R fallback)`,
    );
    run = await rigServe(g);
    demoSay(`dispatcher serving at ${g.base}; journal ${g.dbPath}`);
    await demoDrive(g, evalLog);
  } finally {
    if (run !== undefined) await rigKill(run);
    for (const close of closers.reverse()) await close();
  }
}

try {
  await demoMain();
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : failure);
  process.exitCode = 1;
}
