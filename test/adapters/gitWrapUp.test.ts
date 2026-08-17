/**
 * The git performer against real bare repositories: the merge that completes
 * a `WExclusive` ticket, the conflict the rework economy prices, the ancestor
 * check that lets a re-delivered gate re-answer without touching a ref, the
 * absorption of repeated deliveries, the refusals that hold the cursor, and
 * the fold that resolves the branch at the emission's own decision.
 *
 * The integration walks run the real loop — boot, drive, SQLite journal —
 * with this suite standing in for the fabric: it pushes the work branches a
 * worker would push, and delivers the completions. The gate outcome is read
 * off a capturing wrapper around the drive's own inbound face.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import {
  jArrive,
  jDequeue,
  jDispatch,
  jEvalReduce,
  jGateResolve,
  jRelease,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import { journalLegalOn, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import {
  gitWrapUp,
  type GitWrapUp,
} from "../../src/adapters/gitWrapUp/gitWrapUp.ts";
import { wrapUpBranchAt } from "../../src/adapters/gitWrapUp/resolve.ts";
import {
  scratchCommitMerge,
  scratchFetchHeads,
  scratchMergeTree,
  scratchPrepare,
  scratchPush,
  scratchTipOf,
} from "../../src/adapters/gitWrapUp/scratch.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import { sqliteJournal } from "../../src/adapters/sqliteJournal.ts";
import type { Config } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asProjectId, asTaskId, type TicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Stage } from "../../src/domain/program.ts";
import { wExclusive, type WrapUpOutcome } from "../../src/domain/wrapUp.ts";
import type { Executor } from "../../src/interpreter/executor.ts";
import type { Submitted } from "../../src/interpreter/inbound.ts";
import type { Emission, JournalStore } from "../../src/interpreter/ports.ts";
import { boot } from "../../src/runtime/boot.ts";
import { drive, type Drive, type WakeAfter } from "../../src/runtime/drive.ts";
import { id } from "../domain/fixtures.ts";

const walkConfig: Config = {
  nTickets: 2,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(2),
  gas: 8,
  wrapUpPricing: budgeted(2),
  opRetryPricing: "RetryCharged",
  maxStages: 1,
  nProjects: 1,
};

const walkProgram: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
];

const wakeRefused: WakeAfter = () => {
  throw new Error("the walk booked a retry, so a drain failed under it");
};

function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** A bare origin holding one commit on main, and the work clone this suite commits through. */
function fixtureRemote(dir: string): { remote: string; seed: string } {
  const remote = join(dir, "remote.git");
  const seed = join(dir, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  fixtureGit(seed, "config", "user.name", "fixture");
  fixtureGit(seed, "config", "user.email", "fixture@example.test");
  fixtureCommit(seed, "base.txt", "base\n", "base");
  fixtureGit(seed, "push", "-q", remote, "main:main");
  return { remote, seed };
}

function fixtureCommit(
  seed: string,
  file: string,
  content: string,
  message: string,
): void {
  writeFileSync(join(seed, file), content);
  fixtureGit(seed, "add", ".");
  fixtureGit(seed, "commit", "-q", "-m", message);
}

/** Commits `content` on a branch cut from `from`, and pushes the branch to the remote. */
function fixtureBranch(
  seed: string,
  remote: string,
  branch: string,
  file: string,
  content: string,
  from = "main",
): void {
  fixtureGit(seed, "checkout", "-q", "-B", branch, from);
  fixtureCommit(seed, file, content, branch);
  fixtureGit(seed, "push", "-q", remote, `${branch}:${branch}`);
}

interface WalkReport {
  readonly ticket: TicketId;
  readonly outcome: WrapUpOutcome;
  readonly answer: Submitted;
}

interface Walk {
  readonly driven: Drive;
  readonly performer: GitWrapUp;
  readonly db: DatabaseSync;
  readonly store: JournalStore;
  readonly reported: readonly WalkReport[];
}

/** The real loop over the given remote, with the gate outcomes captured on their way into the drive. */
async function walkOpen(dir: string, remote: string): Promise<Walk> {
  const db = new DatabaseSync(join(dir, "chuggy.sqlite"));
  const store = sqliteJournal(db);
  const performer = gitWrapUp({
    config: walkConfig,
    store,
    db,
    remote,
    scratchDirectory: join(dir, "scratch.git"),
    identity: { name: "chuggy", email: "chuggy@example.test" },
    retryDelaysMs: [10, 20],
  });
  const executor: Executor = {
    config: walkConfig,
    store,
    ports: { fabric: fabricStub(), desk: deskStub(), wrapUp: performer },
  };
  const driven = drive(executor, wakeRefused, await boot(executor));
  const reported: WalkReport[] = [];
  performer.bindInbound({
    ...driven,
    gateOutcome: async (ticket, outcome) => {
      const answer = await driven.gateOutcome(ticket, outcome);
      reported.push({ ticket, outcome, answer });
      return answer;
    },
  });
  return { driven, performer, db, store, reported };
}

/** Arrives and releases the one exclusive ticket, leaving work task 1 running. */
async function walkStart(walk: Walk): Promise<void> {
  await walk.driven.arrive([], walkProgram, asProjectId(1), wExclusive(1));
  await walk.driven.release(id(1));
}

/** Passes the running work and eval tasks, which dequeues the gate and detaches the attempt. */
async function walkPassCycle(
  walk: Walk,
  workTask: number,
  evalTask: number,
): Promise<void> {
  await walk.driven.taskDone(id(1), asTaskId(workTask), "VPass");
  await walk.driven.taskDone(id(1), asTaskId(evalTask), "VPass");
}

function walkPhase(walk: Walk): string {
  return ticketAt(walk.driven.core(), id(1)).phase;
}

const untilTriesMax = 400;

/** Polls for a detached attempt's observable, bounded, so a wedged attempt fails the case rather than the runner. */
async function until(read: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < untilTriesMax; tries++) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waited out ${what}`);
}

/** The journaled emission of the ticket's most recent gate opening, read back the way boot reads it. */
async function walkGateEmission(walk: Walk): Promise<Emission> {
  const loaded = await walk.store.load();
  assert.ok(loaded.parsed === "Ok");
  for (let at = loaded.value.length - 1; at >= 0; at--) {
    const entry = loaded.value[at];
    const effectIndex = entry?.rec.effects.indexOf("OpenGate") ?? -1;
    if (entry !== undefined && effectIndex >= 0) {
      return { seq: entry.seq, effectIndex, ticket: id(1) };
    }
  }
  throw new Error("no journaled OpenGate to re-deliver");
}

interface WalkGround {
  readonly dir: string;
  readonly remote: string;
  readonly seed: string;
  readonly walk: Walk;
}

/** A temp ground with a seeded remote and an open walk, both torn down with the case. */
async function walkGround(t: TestContext): Promise<WalkGround> {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-gitwrapup-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const { remote, seed } = fixtureRemote(dir);
  const walk = await walkOpen(dir, remote);
  t.after(() => {
    walk.db.close();
  });
  return { dir, remote, seed, walk };
}

/** Drives the one ticket through a clean merge to done, leaving the remote's default branch advanced. */
async function walkMerge(ground: WalkGround): Promise<void> {
  await walkStart(ground.walk);
  fixtureBranch(ground.seed, ground.remote, "chug/t1/k1", "work.txt", "work\n");
  await walkPassCycle(ground.walk, 1, 2);
  await until(
    () => walkPhase(ground.walk) === "PDone",
    "the merge to conclude",
  );
}

test("a WExclusive ticket merges: the default branch advances by a merge commit and WOk is reported", async (t) => {
  const ground = await walkGround(t);
  const { remote, walk } = ground;
  const before = fixtureGit(remote, "rev-parse", "main");
  await walkMerge(ground);

  assert.deepEqual(
    walk.reported.map((report) => [report.ticket, report.outcome]),
    [[id(1), "WOk"]],
  );
  const after = fixtureGit(remote, "rev-parse", "main");
  assert.notEqual(after, before);
  assert.deepEqual(
    fixtureGit(remote, "log", "-1", "--format=%P", "main").split(" "),
    [before, fixtureGit(remote, "rev-parse", "chug/t1/k1")],
  );
  const attribution = fixtureGit(
    remote,
    "log",
    "-1",
    "--format=%s|%an|%cn",
    "main",
  );
  assert.equal(attribution, "chug: wrap up ticket 1|chuggy|chuggy");

  const notices = walk.db
    .prepare("SELECT effect FROM wrapup_notices ORDER BY rowid")
    .all()
    .map((row) => row["effect"]);
  assert.deepEqual(notices, ["EnqueueWrapUp", "OpenGate"]);
  const attempts = walk.db.prepare("SELECT outcome FROM wrapup_attempts").all();
  assert.deepEqual(
    attempts.map((row) => row["outcome"]),
    ["WOk"],
  );
  const loaded = await walk.store.load();
  assert.ok(loaded.parsed === "Ok" && journalLegalOn(walkConfig, loaded.value));
});

test("a conflict prices a rework, and the resolved rework's second attempt merges", async (t) => {
  const { remote, seed, walk } = await walkGround(t);
  await walkStart(walk);
  fixtureBranch(seed, remote, "chug/t1/k1", "base.txt", "work side\n");
  fixtureGit(seed, "checkout", "-q", "main");
  fixtureCommit(seed, "base.txt", "trunk side\n", "trunk moved");
  fixtureGit(seed, "push", "-q", remote, "main:main");
  const diverged = fixtureGit(remote, "rev-parse", "main");

  await walkPassCycle(walk, 1, 2);
  await until(
    () => walkPhase(walk) === "PWorking",
    "the conflict to price a rework",
  );
  assert.deepEqual(
    walk.reported.map((report) => report.outcome),
    ["WFailed"],
  );
  assert.equal(fixtureGit(remote, "rev-parse", "main"), diverged);
  const priced = walk.db
    .prepare("SELECT outcome, detail FROM wrapup_attempts")
    .all();
  assert.equal(priced[0]?.["outcome"], "WFailed");
  assert.match(String(priced[0]?.["detail"]), /CONFLICT/);

  fixtureGit(seed, "fetch", "-q", remote, "main");
  fixtureBranch(
    seed,
    remote,
    "chug/t1/k3",
    "base.txt",
    "resolved\n",
    "FETCH_HEAD",
  );
  await walkPassCycle(walk, 3, 4);
  await until(() => walkPhase(walk) === "PDone", "the second attempt to merge");
  assert.deepEqual(
    walk.reported.map((report) => report.outcome),
    ["WFailed", "WOk"],
  );
  assert.deepEqual(
    fixtureGit(remote, "log", "-1", "--format=%P", "main").split(" "),
    [diverged, fixtureGit(remote, "rev-parse", "chug/t1/k3")],
  );
});

test("a re-delivered gate re-answers: from the table when concluded, by the ancestor check when the row is lost", async (t) => {
  const ground = await walkGround(t);
  const { remote, walk } = ground;
  await walkMerge(ground);
  const merged = fixtureGit(remote, "rev-parse", "main");
  const emission = await walkGateEmission(walk);

  await walk.performer.openGate(emission);
  await until(() => walk.reported.length === 2, "the re-answer from the table");
  assert.equal(walk.reported[1]?.outcome, "WOk");
  assert.equal(walk.reported[1]?.answer.submitted, "Dropped");
  assert.equal(fixtureGit(remote, "rev-parse", "main"), merged);

  walk.db.prepare("DELETE FROM wrapup_attempts").run();
  await walk.performer.openGate(emission);
  await until(() => walk.reported.length === 3, "the ancestor check to answer");
  assert.equal(walk.reported[2]?.outcome, "WOk");
  assert.equal(fixtureGit(remote, "rev-parse", "main"), merged);
  const restored = walk.db
    .prepare("SELECT outcome, detail FROM wrapup_attempts")
    .all();
  assert.equal(restored[0]?.["outcome"], "WOk");
  assert.match(String(restored[0]?.["detail"]), /already merged/);

  const enqueue: Emission = {
    seq: emission.seq - 1,
    effectIndex: 0,
    ticket: id(1),
  };
  await walk.performer.enqueueWrapUp(enqueue);
  await walk.performer.enqueueWrapUp(enqueue);
  const openGateNotices = walk.db
    .prepare(
      "SELECT COUNT(*) AS held FROM wrapup_notices WHERE effect = 'OpenGate'",
    )
    .get();
  assert.equal(openGateNotices?.["held"], 1);
});

test("an unreachable remote exhausts the bounded ladder and is priced onto the ticket", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-gitwrapup-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const walk = await walkOpen(dir, join(dir, "nowhere.git"));
  t.after(() => {
    walk.db.close();
  });
  await walkStart(walk);
  await walkPassCycle(walk, 1, 2);
  await until(
    () => walkPhase(walk) === "PWorking",
    "the exhaustion to price a rework",
  );
  assert.deepEqual(
    walk.reported.map((report) => report.outcome),
    ["WFailed"],
  );
  const priced = walk.db.prepare("SELECT detail FROM wrapup_attempts").get();
  assert.match(String(priced?.["detail"]), /machinery failed/);
});

test("a push racing a moved default branch is refused, and the next lap re-fetches, re-merges and lands", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-gitwrapup-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const { remote, seed } = fixtureRemote(dir);
  fixtureBranch(seed, remote, "chug/t1/k1", "work.txt", "work\n");
  const scratch = join(dir, "scratch.git");
  const identity = { name: "chuggy", email: "chuggy@example.test" };
  scratchPrepare(scratch);
  await scratchFetchHeads(scratch, remote);
  const staleTip = await scratchTipOf(scratch, "main");
  const workTip = await scratchTipOf(scratch, "chug/t1/k1");
  assert.ok(staleTip !== undefined && workTip !== undefined);

  fixtureGit(seed, "checkout", "-q", "main");
  fixtureCommit(seed, "moved.txt", "moved\n", "the operator moved main");
  fixtureGit(seed, "push", "-q", remote, "main:main");
  const movedTip = fixtureGit(remote, "rev-parse", "main");

  const stale = await scratchMergeTree(scratch, staleTip, workTip);
  assert.ok(stale.merged === "MClean");
  const staleMerge = await scratchCommitMerge(
    scratch,
    identity,
    stale.tree,
    [staleTip, workTip],
    "stale merge",
  );
  await assert.rejects(
    scratchPush(scratch, remote, staleMerge, "main"),
    /git push exited/,
  );
  assert.equal(fixtureGit(remote, "rev-parse", "main"), movedTip);

  await scratchFetchHeads(scratch, remote);
  const currentTip = await scratchTipOf(scratch, "main");
  assert.equal(currentTip, movedTip);
  const remerge = await scratchMergeTree(scratch, movedTip, workTip);
  assert.ok(remerge.merged === "MClean");
  const landed = await scratchCommitMerge(
    scratch,
    identity,
    remerge.tree,
    [movedTip, workTip],
    "landed merge",
  );
  await scratchPush(scratch, remote, landed, "main");
  assert.equal(fixtureGit(remote, "rev-parse", "main"), landed);
});

/** The journal a sequence of decisions leaves, built through the actor's own step so it is legal by construction. */
function resolveJournal(commands: readonly Cmd[]): readonly Entry[] {
  return commands.reduce(
    (state, cmd) => journalStep(walkConfig, state, cmd),
    actorInit(),
  ).journal;
}

const resolveReworkHistory: readonly Cmd[] = [
  jArrive([], walkProgram, asProjectId(1), wExclusive(1)),
  jRelease(id(1)),
  jDispatch(id(1)),
  jTaskDone(id(1), asTaskId(1), "VPass"),
  jWorkReduce(id(1)),
  jTaskDone(id(1), asTaskId(2), "VFail"),
  jEvalReduce(id(1)),
  jTaskDone(id(1), asTaskId(3), "VPass"),
  jWorkReduce(id(1)),
  jTaskDone(id(1), asTaskId(4), "VPass"),
  jEvalReduce(id(1)),
  jDequeue(id(1), true),
];

test("the fold resolves the branch at the emission's decision, and a rework's second mark wins", () => {
  const journal = resolveJournal(resolveReworkHistory);
  const firstGate: Emission = { seq: 12, effectIndex: 0, ticket: id(1) };
  assert.equal(wrapUpBranchAt(walkConfig, journal, firstGate), "chug/t1/k3");

  const extended = resolveJournal([
    ...resolveReworkHistory,
    jGateResolve(id(1), "WFailed"),
    jTaskDone(id(1), asTaskId(5), "VPass"),
    jWorkReduce(id(1)),
    jTaskDone(id(1), asTaskId(6), "VPass"),
    jEvalReduce(id(1)),
    jDequeue(id(1), true),
  ]);
  const secondGate: Emission = { seq: 18, effectIndex: 0, ticket: id(1) };
  assert.equal(wrapUpBranchAt(walkConfig, extended, secondGate), "chug/t1/k5");
  assert.equal(wrapUpBranchAt(walkConfig, extended, firstGate), "chug/t1/k3");
});

test("a delivery the fold cannot serve is refused by throwing", () => {
  const journal = resolveJournal(resolveReworkHistory.slice(0, 3));
  assert.throws(
    () =>
      wrapUpBranchAt(walkConfig, journal, {
        seq: 3,
        effectIndex: 0,
        ticket: id(1),
      }),
    /no produced artifact/,
  );
  assert.throws(
    () =>
      wrapUpBranchAt(walkConfig, journal, {
        seq: 9,
        effectIndex: 0,
        ticket: id(1),
      }),
    /no decision 9/,
  );
});

test("a journal the store refuses refuses the delivery, and a wrong fan-out refuses construction", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-gitwrapup-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const refusing: JournalStore = {
    append: () => Promise.resolve(),
    load: () => Promise.resolve({ parsed: "Refused", why: "torn row" }),
    loadCursor: () => Promise.resolve(0),
    saveCursor: () => Promise.resolve(),
  };
  const db = new DatabaseSync(":memory:");
  t.after(() => {
    db.close();
  });
  const performer = gitWrapUp({
    config: walkConfig,
    store: refusing,
    db,
    remote: join(dir, "remote.git"),
    scratchDirectory: join(dir, "scratch.git"),
    identity: { name: "chuggy", email: "chuggy@example.test" },
    retryDelaysMs: [],
  });
  await assert.rejects(
    performer.openGate({ seq: 1, effectIndex: 0, ticket: id(1) }),
    /did not parse/,
  );
  assert.throws(
    () =>
      gitWrapUp({
        config: { ...walkConfig, nTasks: 2 },
        store: refusing,
        db,
        remote: join(dir, "remote.git"),
        scratchDirectory: join(dir, "scratch2.git"),
        identity: { name: "chuggy", email: "chuggy@example.test" },
      }),
    /nTasks is not 1/,
  );
});
