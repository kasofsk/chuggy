/**
 * The setup program's files on a real disk, and its lock between real
 * processes.
 *
 * What the decisions assume of the files port is held here against the
 * adapter that fills it: a file only its owner can read, a write no reader
 * finds half of, and a file only one of several callers makes. The lock is
 * then held over whole runs of the program, where what it protects is a
 * renewal token no two runs may both spend.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { filesIn } from "../../ui/chuggy-ui/terminal/files.ts";
import { making, person } from "./program.ts";
import type { Home } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

function permissions(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

test("a file and its directory are the person's alone, whatever the process would have allowed", () => {
  const machine = made.machine();
  const allowed = process.umask(0);
  try {
    const files = filesIn(machine.directory);
    files.write("session.json", "first");
    assert.equal(files.create("lock", "mine"), true);
    assert.equal(permissions(machine.directory), "700");
    assert.equal(permissions(join(machine.directory, "session.json")), "600");
    assert.equal(permissions(join(machine.directory, "lock")), "600");
  } finally {
    process.umask(allowed);
  }
});

test("a write replaces the file whole, and leaves nothing beside it", () => {
  const machine = made.machine();
  const files = filesIn(machine.directory);
  const placed = join(machine.directory, "session.json");
  files.write("session.json", "first");
  const before = statSync(placed).ino;
  const reader = openSync(placed, "r");
  try {
    files.write("session.json", "second, and longer");
    assert.equal(readFileSync(reader, "utf8"), "first");
  } finally {
    closeSync(reader);
  }
  assert.notEqual(statSync(placed).ino, before);
  assert.equal(files.read("session.json"), "second, and longer");
  assert.deepEqual(readdirSync(machine.directory), ["session.json"]);
});

test("a file that is not there is read as nothing, and removing it twice is no failure", () => {
  const files = filesIn(made.machine().directory);
  assert.equal(files.read("lock"), undefined);
  files.remove("lock");
  files.write("sign-in.json", "note");
  files.remove("sign-in.json");
  files.remove("sign-in.json");
  assert.equal(files.read("sign-in.json"), undefined);
});

test("a file that exists is not made again, and keeps what its maker wrote", () => {
  const machine = made.machine();
  const files = filesIn(machine.directory);
  assert.equal(files.create("lock", "first"), true);
  assert.equal(files.create("lock", "second"), false);
  assert.equal(files.read("lock"), "first");
  assert.deepEqual(readdirSync(machine.directory), ["lock"]);
});

const adapter = pathToFileURL(
  join(process.cwd(), "ui/chuggy-ui/terminal/files.ts"),
).href;

const racer = `
  const { filesIn } = await import(process.argv[1]);
  const files = filesIn(process.argv[2]);
  while (Date.now() < Number(process.argv[3]));
  process.stdout.write(files.create('lock', String(process.pid)) ? 'made' : 'refused');
`;

test("of several processes making the lock at one instant, one makes it", async () => {
  const machine = made.machine();
  const startsAtMs = Date.now() + 1_500;
  const answers = await Promise.all(
    Array.from(
      { length: 6 },
      () =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              racer,
              adapter,
              machine.directory,
              String(startsAtMs),
            ],
            { stdio: ["ignore", "pipe", "inherit"] },
          );
          let said = "";
          child.stdout.on("data", (chunk: Buffer) => {
            said += chunk.toString("utf8");
          });
          child.once("error", reject);
          child.once("close", () => {
            resolve(said);
          });
        }),
    ),
  );
  assert.deepEqual(answers.toSorted(), [
    "made",
    "refused",
    "refused",
    "refused",
    "refused",
    "refused",
  ]);
});

async function signedIn(): Promise<{
  readonly installation: StandIn;
  readonly machine: Home;
}> {
  const installation = await made.installation();
  const machine = made.machine();
  const running = machine.run(["sign-in", "--site", installation.site]);
  await person(await machine.opened());
  assert.equal((await running).code, 0);
  return { installation, machine };
}

test("a run that finds the lock held by a running process spends nothing and says it is busy", async () => {
  const { installation, machine } = await signedIn();
  const session = machine.file("session.json");
  const lock = JSON.stringify({ pid: process.pid, takenAtMs: Date.now() });
  writeFileSync(join(machine.directory, "lock"), lock);
  const refused = await machine.run([]);
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.lines.slice(0, -1), [
    "found: another chuggy setup command is running on this machine",
  ]);
  assert.match(refused.lines.at(-1) ?? "", /^next: node \S+$/u);
  assert.equal(machine.file("lock"), lock);
  assert.ok(machine.file("session.json") === session);
  assert.deepEqual(installation.grants, ["authorization_code granted"]);
});

test("a lock whose holder has gone is taken, and given up when the run ends", async () => {
  const { installation, machine } = await signedIn();
  const gone = spawnSync(process.execPath, ["--eval", ""]).pid;
  writeFileSync(
    join(machine.directory, "lock"),
    JSON.stringify({ pid: gone, takenAtMs: Date.now() }),
  );
  const done = await machine.run([]);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.equal(machine.file("lock"), undefined);
});

test("runs started together each renew in turn with what the one before stored", async () => {
  const { installation, machine } = await signedIn();
  const runs = await Promise.all([
    machine.run([]),
    machine.run([]),
    machine.run([]),
  ]);
  for (const done of runs)
    assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.deepEqual(installation.grants, [
    "authorization_code granted",
    "refresh_token granted",
    "refresh_token granted",
    "refresh_token granted",
  ]);
  const stored = JSON.parse(machine.file("session.json") ?? "{}") as {
    readonly refreshToken?: string;
  };
  assert.ok(stored.refreshToken === installation.renewal());
});

test("a home the program cannot keep its files in is a failure said in one line, with no trace of why", async () => {
  const machine = made.machine();
  mkdirSync(machine.home, { recursive: true });
  writeFileSync(machine.directory, "in the way");
  const done = await machine.run(["--site", "http://127.0.0.1:9"]);
  assert.equal(done.code, 1);
  assert.equal(done.stderr, "");
  assert.deepEqual(done.lines.slice(0, -1), [
    "found: chuggy setup stopped on something it did not expect",
  ]);
});
