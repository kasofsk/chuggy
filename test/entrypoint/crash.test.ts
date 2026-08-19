/**
 * The dispatcher killed for real: `kill -9` at three deterministically held
 * seams of the one process `npm start` runs, each case restarting the same
 * deployment and asserting from outside — the journal read back through the
 * wire parse and `journalLegalOn`, the adapters' own tables, the fake API's
 * log, and the bare remote. The holds are what make the kill a point rather
 * than a race: the fake API can sit on a Job create's answer after the store
 * took it, and the remote's post-receive hook can sit on the wrap-up's push
 * after the refs moved.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";

import {
  rigArrive,
  rigAttempts,
  rigCursor,
  rigGit,
  rigGrant,
  rigGround,
  rigHoldMainPush,
  rigJob,
  rigJobPosts,
  rigJournal,
  rigKill,
  rigLabels,
  rigOperator,
  rigPhaseOf,
  rigPost,
  rigRunJob,
  rigServe,
  rigSpawnRows,
  rigUntil,
  type RigDesk,
  type RigGround,
  type RigRun,
} from "./rig.ts";

/** Boots the dispatcher, torn down at the case's end whether or not the case already killed it. */
async function crashServe(t: TestContext, g: RigGround): Promise<RigRun> {
  const run = await rigServe(g);
  t.after(() => rigKill(run));
  return run;
}

/** Grants, authors and returns the one ticket every case drives. */
async function crashTicket(
  g: RigGround,
  taskType: string,
  wrapUp: string,
): Promise<{ readonly desk: RigDesk; readonly ticket: number }> {
  const desk = await rigOperator(g);
  await rigGrant(desk);
  return { desk, ticket: await rigArrive(desk, taskType, wrapUp) };
}

/** Runs the named Job as the worker and requires the worker's own exit clean. */
async function crashWork(g: RigGround, name: string): Promise<void> {
  const ran = await rigRunJob(g.fake, await rigJob(g.fake, name));
  assert.equal(ran.code, 0, `the worker for ${name} failed: ${ran.output}`);
}

test("a kill between the Job create and the cursor save re-serves into absorption on restart", async (t) => {
  const g = await rigGround(t);
  const run = await crashServe(t, g);
  const { desk, ticket } = await crashTicket(g, "code", "WNone");
  const hold = g.fake.holdNextCreate();
  void rigPost(desk, `/api/tickets/${String(ticket)}/release`, {}).catch(
    () => undefined,
  );
  await hold.arrived;
  await rigKill(run);
  hold.release();

  const killed = rigJournal(g.dbPath);
  assert.deepEqual(rigLabels(killed), [
    "ticket-arrived",
    "ticket-released",
    "dispatch",
  ]);
  assert.equal(rigCursor(g.dbPath), killed.length - 1);
  assert.deepEqual(rigSpawnRows(g.dbPath), []);
  assert.equal(g.fake.jobs().length, 1);

  await crashServe(t, g);
  await rigUntil(
    () => rigSpawnRows(g.dbPath).length === 1,
    "the re-served spawn to record its row",
  );
  assert.equal(g.fake.created.length, 1);
  assert.equal(rigJobPosts(g.fake).length, 2);

  await crashWork(g, `chug-t${String(ticket)}-k1`);
  await crashWork(g, `chug-t${String(ticket)}-k2`);
  await rigUntil(
    () => rigPhaseOf(rigJournal(g.dbPath), ticket) === "PDone",
    "the ticket to complete",
  );
  assert.equal(g.fake.created.length, 2);
  assert.equal(new Set(g.fake.created.map((job) => job.metadata.name)).size, 2);
});

test("a kill between the wrap-up's push and its report re-answers without a second merge", async (t) => {
  const g = await rigGround(t);
  const hold = rigHoldMainPush(g.remote, g.dir);
  const base = rigGit(g.remote, "rev-parse", "main");
  const run = await crashServe(t, g);
  const { desk, ticket } = await crashTicket(g, "merge", "WExclusive:1");
  await rigPost(desk, `/api/tickets/${String(ticket)}/release`, {});
  await crashWork(g, `chug-t${String(ticket)}-k1`);
  await crashWork(g, `chug-t${String(ticket)}-k2`);

  await rigUntil(() => existsSync(hold.marker), "the merge push to be held");
  const merged = readFileSync(hold.marker, "utf8").trim();
  assert.equal(rigGit(g.remote, "rev-parse", "main"), merged);
  await rigKill(run);
  hold.release();

  const killed = rigJournal(g.dbPath);
  assert.equal(rigPhaseOf(killed, ticket), "PWrapUpHolding");
  assert.deepEqual(rigAttempts(g.dbPath), []);
  const branch = `chug/t${String(ticket)}/k1`;
  assert.deepEqual(
    rigGit(g.remote, "log", "-1", "--format=%P", "main").split(" "),
    [base, rigGit(g.remote, "rev-parse", branch)],
  );

  await crashServe(t, g);
  await rigUntil(
    () => rigPhaseOf(rigJournal(g.dbPath), ticket) === "PDone",
    "the re-driven gate to resolve the ticket",
  );
  assert.equal(rigGit(g.remote, "rev-parse", "main"), merged);
  const attempts = rigAttempts(g.dbPath);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.outcome, "WOk");
  assert.match(String(attempts[0]?.detail), /already merged/);
});

test("a kill after the completion's ack loses nothing: the journaled task-done survives the unfinished drain", async (t) => {
  const g = await rigGround(t);
  const run = await crashServe(t, g);
  const { desk, ticket } = await crashTicket(g, "code", "WNone");
  await rigPost(desk, `/api/tickets/${String(ticket)}/release`, {});
  const work = await rigJob(g.fake, `chug-t${String(ticket)}-k1`);

  g.fake.failNextCreate(500);
  const hold = g.fake.holdNextCreate();
  const acked = await rigRunJob(g.fake, work);
  assert.equal(acked.code, 0, `the worker was not acked: ${acked.output}`);
  await rigKill(run);
  hold.release();

  const killed = rigJournal(g.dbPath);
  assert.deepEqual(rigLabels(killed).slice(3), ["task-done", "work-passed"]);
  assert.equal(rigCursor(g.dbPath), killed.length - 1);

  await crashServe(t, g);
  await crashWork(g, `chug-t${String(ticket)}-k2`);
  await rigUntil(
    () => rigPhaseOf(rigJournal(g.dbPath), ticket) === "PDone",
    "the ticket to complete",
  );
  const done = rigJournal(g.dbPath);
  const workCompletions = done.filter(
    (entry) => entry.cmd.cmd === "JTaskDone" && entry.cmd.taskId === 1,
  );
  assert.equal(workCompletions.length, 1);
  assert.equal(
    g.fake.created.filter(
      (job) => job.metadata.name === `chug-t${String(ticket)}-k1`,
    ).length,
    1,
  );
});
