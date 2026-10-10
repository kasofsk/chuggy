/**
 * The setup program's files and its lock on a real disk, and the lock between
 * real processes.
 *
 * What the decisions assume of the two ports is held here against the
 * adapters that fill them: a file only its owner can read, a write no reader
 * finds half of, and a lock that changes only from the word a caller names,
 * so that of several processes naming the same word one is answered yes. The
 * lock is then held over whole runs of the program, where what it protects is
 * a renewal token no two runs may both spend.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { SetupMachineError } from "../../ui/chuggy-ui/app/core/setupPorts.ts";
import type { SetupMachineFault } from "../../ui/chuggy-ui/app/core/setupPorts.ts";
import { filesIn } from "../../ui/chuggy-ui/terminal/files.ts";
import { lockIn } from "../../ui/chuggy-ui/terminal/lock.ts";
import { homeOf } from "../../ui/chuggy-ui/terminal/ports.ts";
import { eventually, finished, making, person } from "./program.ts";
import type { Home } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

function permissions(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

/** The number of a process that has run and gone, so nothing answers to it. */
function departed(): number {
  return spawnSync(process.execPath, ["--eval", ""]).pid;
}

/** Leaves the lock saying `word`, as a run that held it and was killed would. */
function left(directory: string, word: string): void {
  const lock = join(directory, "lock");
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, word), "");
}

/** What `step` throws where the machine would not do it: which path, and whether it was being written or read. */
function refused(step: () => unknown): SetupMachineFault | undefined {
  try {
    step();
  } catch (failure: unknown) {
    assert.ok(failure instanceof SetupMachineError);
    assert.ok(!/E[A-Z]{4,}|errno|syscall/u.test(failure.message));
    return failure.fault;
  }
  return undefined;
}

test("a file, the lock and their directory are the person's alone, whatever the process would have allowed", () => {
  const machine = made.machine();
  const allowed = process.umask(0);
  try {
    filesIn(machine.directory).write("session.json", "first");
    assert.equal(lockIn(machine.directory).swap(undefined, "7.1"), true);
    assert.equal(permissions(machine.directory), "700");
    assert.equal(permissions(join(machine.directory, "session.json")), "600");
    assert.equal(permissions(join(machine.directory, "lock")), "700");
    assert.equal(permissions(join(machine.directory, "lock", "7.1")), "600");
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
  assert.equal(files.read("session.json"), undefined);
  files.remove("session.json");
  files.sweep("session.json");
  files.write("sign-in.json", "note");
  files.remove("sign-in.json");
  files.remove("sign-in.json");
  assert.equal(files.read("sign-in.json"), undefined);
});

test("what a write that was cut short left of a file is removed, and nothing else in the directory is", () => {
  const machine = made.machine();
  const files = filesIn(machine.directory);
  files.write("session.json", "kept");
  const others = [
    "session.json.bak",
    "session.json.mine.draft",
    "session.json..draft",
    "sign-in.json.7.draft",
    "xsession.json.7.draft",
  ];
  for (const name of ["session.json.7.draft", "session.json.4194304.draft"])
    writeFileSync(join(machine.directory, name), "a token being written");
  for (const name of others) writeFileSync(join(machine.directory, name), "");
  files.sweep("session.json");
  assert.deepEqual(
    readdirSync(machine.directory).toSorted(),
    ["session.json", ...others].toSorted(),
  );
  assert.equal(files.read("session.json"), "kept");
});

test("a lock that was never made is free, is made saying its first holder's word, and then changes only from the word it says", () => {
  const { directory } = made.machine();
  const lock = lockIn(directory);
  assert.equal(lock.read(), undefined);
  assert.equal(lock.swap("7.1", "8.2"), false);
  assert.equal(existsSync(directory), false);
  assert.equal(lock.swap(undefined, "7.1"), true);
  assert.equal(lock.read(), "7.1");
  assert.equal(lock.swap(undefined, "8.2"), false);
  assert.equal(lock.swap("9.9", "8.2"), false);
  assert.equal(lock.read(), "7.1");
  assert.equal(lock.swap("7.1", "8.2"), true);
  assert.equal(lock.swap("7.1", "9.3"), false);
  assert.equal(lock.read(), "8.2");
  assert.equal(lock.swap("8.2", undefined), true);
  assert.equal(lock.read(), undefined);
  assert.equal(lock.swap("8.2", undefined), false);
  assert.deepEqual(readdirSync(join(directory, "lock")), ["free"]);
  assert.equal(lock.swap(undefined, "9.3"), true);
  assert.equal(lock.read(), "9.3");
  assert.deepEqual(readdirSync(directory), ["lock"]);
});

test("a lock says only a holder's word, and one that was left saying two is a failure and not a lock to take", () => {
  const { directory } = made.machine();
  const lock = lockIn(directory);
  for (const word of ["../session.json", "free", "", "7", "7.1/8.2", ".."])
    assert.throws(() => lock.swap(undefined, word), word);
  assert.equal(existsSync(join(directory, "session.json")), false);
  assert.equal(lock.swap(undefined, "7.1"), true);
  assert.equal(lock.swap("../lock/7.1", "8.2"), false);
  assert.equal(lock.read(), "7.1");
  writeFileSync(join(directory, "lock", "8.2"), "");
  assert.deepEqual(
    refused(() => lock.read()),
    { fault: "Unreadable", path: join(directory, "lock") },
  );
  rmSync(join(directory, "lock", "8.2"));
  writeFileSync(join(directory, "lock", "free"), "");
  assert.deepEqual(
    refused(() => lock.read()),
    { fault: "Unreadable", path: join(directory, "lock") },
  );
});

test("the lock reads past a name beside its word that is no word of the lock, and changes hands as if it were not there", () => {
  const { directory } = made.machine();
  const lock = lockIn(directory);
  const stray = join(directory, "lock", ".DS_Store");
  assert.equal(lock.swap(undefined, "7.1"), true);
  writeFileSync(stray, "a file manager's");
  assert.equal(lock.read(), "7.1");
  assert.equal(lock.swap(undefined, "8.2"), false);
  assert.equal(lock.swap("7.1", "8.2"), true);
  assert.equal(lock.read(), "8.2");
  assert.equal(lock.swap("8.2", undefined), true);
  assert.equal(lock.read(), undefined);
  assert.equal(lock.swap(undefined, "9.3"), true);
  assert.equal(lock.read(), "9.3");
  assert.deepEqual(readdirSync(join(directory, "lock")).toSorted(), [
    ".DS_Store",
    "9.3",
  ]);
  assert.equal(readFileSync(stray, "utf8"), "a file manager's");
});

test("a lock left holding only a name that is no word of it says that name, and is taken from it by one run", () => {
  const { directory } = made.machine();
  mkdirSync(join(directory, "lock"), { recursive: true });
  writeFileSync(join(directory, "lock", ".DS_Store"), "");
  const lock = lockIn(directory);
  assert.equal(lock.read(), ".DS_Store");
  assert.equal(lock.swap(undefined, "7.1"), false);
  assert.equal(lock.swap(".DS_Store", "7.1"), true);
  assert.equal(lock.swap(".DS_Store", "8.2"), false);
  assert.equal(lock.read(), "7.1");
  assert.deepEqual(readdirSync(join(directory, "lock")), ["7.1"]);
});

test("a lock left with nothing in it is made whole and moved into place by the one run that takes it", () => {
  const { directory } = made.machine();
  mkdirSync(join(directory, "lock"), { recursive: true });
  const lock = lockIn(directory);
  assert.equal(lock.read(), undefined);
  assert.equal(lock.swap(undefined, "7.1"), true);
  assert.equal(lock.swap(undefined, "8.2"), false);
  assert.equal(lock.read(), "7.1");
  assert.deepEqual(readdirSync(join(directory, "lock")), ["7.1"]);
  assert.deepEqual(readdirSync(directory), ["lock"]);
});

test("what the machine will not write or read is thrown as which path, and what is not there is read as nothing", () => {
  const machine = made.machine();
  const { directory } = machine;
  writeFileSync(directory, "in the way");
  const files = filesIn(directory);
  const lock = lockIn(directory);
  assert.equal(files.read("session.json"), undefined);
  assert.equal(lock.read(), undefined);
  files.remove("session.json");
  files.sweep("session.json");
  assert.deepEqual(
    refused(() => {
      files.write("session.json", "kept");
    }),
    { fault: "Unwritable", path: directory },
  );
  assert.deepEqual(
    refused(() => lock.swap(undefined, "7.1")),
    { fault: "Unwritable", path: directory },
  );
  rmSync(directory);
  mkdirSync(join(directory, "session.json"), { recursive: true });
  writeFileSync(join(directory, "lock"), "in the way");
  assert.deepEqual(
    refused(() => files.read("session.json")),
    { fault: "Unreadable", path: join(directory, "session.json") },
  );
  assert.deepEqual(
    refused(() => {
      files.write("session.json", "kept");
    }),
    { fault: "Unwritable", path: join(directory, "session.json") },
  );
  assert.deepEqual(
    refused(() => lock.swap(undefined, "7.1")),
    { fault: "Unwritable", path: join(directory, "lock") },
  );
});

test("a home is a whole path the machine names, and anything else is no home", () => {
  assert.equal(
    homeOf(() => "/home/person"),
    "/home/person",
  );
  assert.equal(
    homeOf(() => ""),
    undefined,
  );
  assert.equal(
    homeOf(() => "home/person"),
    undefined,
  );
  assert.equal(
    homeOf(() => "."),
    undefined,
  );
  assert.equal(
    homeOf(() => {
      throw new Error("no entry for this user");
    }),
    undefined,
  );
});

test("a word nobody could have written is read as it is, so whoever judges it nobody's takes it from that word", () => {
  const { directory } = made.machine();
  left(directory, "left by hand");
  const lock = lockIn(directory);
  assert.equal(lock.read(), "left by hand");
  assert.equal(lock.swap("left by hand", "7.1"), true);
  assert.deepEqual(readdirSync(join(directory, "lock")), ["7.1"]);
});

const sources = (name: string): string =>
  pathToFileURL(join(process.cwd(), "ui/chuggy-ui", name)).href;

/** Runs `script` as a process of its own, bounded as every process a suite starts is. */
function raced(script: string, argv: readonly string[]): Promise<string> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script, ...argv],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return finished(child).then((done) => {
    assert.equal(done.stderr, "");
    return done.stdout;
  });
}

const maker = `
  const { lockIn } = await import(process.argv[1]);
  const lock = lockIn(process.argv[2]);
  while (Date.now() < Number(process.argv[3]));
  process.stdout.write(lock.swap(undefined, process.pid + '.1') ? 'made' : 'refused');
`;

/** Several processes that each try to make the lock in `directory` at one instant, as what each answered. */
async function makers(directory: string): Promise<readonly string[]> {
  const startsAtMs = Date.now() + 1_500;
  const answers = await Promise.all(
    Array.from({ length: 6 }, () =>
      raced(maker, [
        sources("terminal/lock.ts"),
        directory,
        String(startsAtMs),
      ]),
    ),
  );
  return answers.toSorted();
}

const oneMade = ["made", "refused", "refused", "refused", "refused", "refused"];

test("of several processes making the lock at one instant, one makes it", async () => {
  const { directory } = made.machine();
  assert.deepEqual(await makers(directory), oneMade);
  assert.equal(readdirSync(join(directory, "lock")).length, 1);
  assert.deepEqual(readdirSync(directory), ["lock"]);
});

test("of several processes that meet a lock with nothing in it at one instant, one makes it", async () => {
  const { directory } = made.machine();
  mkdirSync(join(directory, "lock"), { recursive: true });
  assert.deepEqual(await makers(directory), oneMade);
  assert.equal(readdirSync(join(directory, "lock")).length, 1);
  assert.deepEqual(readdirSync(directory), ["lock"]);
});

/**
 * One of several processes that meet a dead run's lock at the same instant,
 * round after round, each round a directory of its own. Whoever takes a lock
 * makes that round's marker, which a second taker finds already made; nobody
 * gives a lock up, and nobody leaves until all have finished, so the one
 * holder of each round is there for as long as anyone could judge its word.
 */
const taker = `
  import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
  import { setTimeout as slept } from 'node:timers/promises';
  const [files, lock, store, root, startsAtMs, periodMs, rounds] = process.argv.slice(1);
  const { filesIn } = await import(files);
  const { lockIn } = await import(lock);
  const { setupLockTaken } = await import(store);
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  const said = [];
  for (let round = 0; round < Number(rounds); round += 1) {
    const directory = root + '/round-' + round;
    const ports = {
      files: filesIn(directory),
      lock: lockIn(directory),
      nowMs: () => Date.now(),
      sleepMs: () => Promise.resolve(),
      process: { pid: process.pid, alive },
    };
    while (Date.now() < Number(startsAtMs) + round * Number(periodMs));
    if (!(await setupLockTaken(ports, 0))) said.push('waited');
    else
      try { mkdirSync(directory + '/taken'); said.push('held'); }
      catch { said.push('overlapped'); }
  }
  writeFileSync(root + '/said/' + process.pid + '.draft', said.join(' '));
  renameSync(root + '/said/' + process.pid + '.draft', root + '/said/' + process.pid);
  for (let waited = 0; waited < 600 && !existsSync(root + '/over'); waited += 1) await slept(50);
`;

const takers = 6;
const rounds = 40;

test("of several processes that meet a dead run's lock at one instant, round after round, one takes it each time", async () => {
  const root = made.machine().beside;
  const dead = departed();
  mkdirSync(join(root, "said"));
  for (let round = 0; round < rounds; round += 1)
    left(
      join(root, `round-${String(round)}`),
      `${String(dead)}.${String(Date.now())}`,
    );
  const argv = [
    sources("terminal/files.ts"),
    sources("terminal/lock.ts"),
    sources("app/core/setupStore.ts"),
    root,
    String(Date.now() + 1_500),
    "25",
    String(rounds),
  ];
  const racing = Array.from({ length: takers }, () => raced(taker, argv));
  const guarded = Promise.all(racing);
  guarded.catch(() => undefined);
  try {
    await eventually(() =>
      readdirSync(join(root, "said")).filter((name) => /^\d+$/u.test(name))
        .length === takers
        ? true
        : undefined,
    );
  } finally {
    writeFileSync(join(root, "over"), "");
  }
  await guarded;
  const said = readdirSync(join(root, "said")).map((name) =>
    readFileSync(join(root, "said", name), "utf8").split(" "),
  );
  for (let round = 0; round < rounds; round += 1)
    assert.deepEqual(
      said.map((answers) => answers[round]).toSorted(),
      ["held", ...Array.from({ length: takers - 1 }, () => "waited")],
      `round ${String(round)}`,
    );
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
  const held = `${String(process.pid)}.${String(Date.now())}`;
  left(machine.directory, held);
  const busy = await machine.run([]);
  assert.equal(busy.code, 1);
  assert.equal(busy.stderr, "");
  assert.deepEqual(busy.lines.slice(0, 2), [
    `found: another chuggy setup command is running on this machine, as process ${String(process.pid)}`,
    "tell: Another chuggy setup command is still running on this machine, so this one did nothing. I will run it again once the other has ended.",
  ]);
  assert.match(
    busy.lines[2] ?? "",
    /^rule: Run node \S+ only once that command has ended\.$/u,
  );
  assert.deepEqual(busy.lines.slice(3), ["next: stop"]);
  assert.equal(machine.lock(), held);
  assert.ok(machine.file("session.json") === session);
  assert.deepEqual(installation.grants, ["authorization_code granted"]);
});

test("a name a file manager left in the lock's folder stops no command, and is still there afterwards", async () => {
  const { installation, machine } = await signedIn();
  const stray = join(machine.directory, "lock", ".DS_Store");
  writeFileSync(stray, "");
  for (let asked = 0; asked < 2; asked += 1) {
    const done = await machine.run([]);
    assert.equal(done.code, 0, done.stdout);
    assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  }
  assert.deepEqual(readdirSync(join(machine.directory, "lock")).toSorted(), [
    ".DS_Store",
    "free",
  ]);
  assert.deepEqual(installation.grants, [
    "authorization_code granted",
    "refresh_token granted",
    "refresh_token granted",
  ]);
});

test("a lock whose holder has gone is taken, and given up when the run ends", async () => {
  const { installation, machine } = await signedIn();
  left(machine.directory, `${String(departed())}.${String(Date.now())}`);
  const done = await machine.run([]);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.equal(machine.lock(), undefined);
  assert.deepEqual(readdirSync(join(machine.directory, "lock")), ["free"]);
});

const together = 4;
const meetings = 5;

test("runs that meet a dead run's lock together renew in turn all the same, and no spent token is ever sent", async () => {
  const { installation, machine } = await signedIn();
  for (let meeting = 0; meeting < meetings; meeting += 1) {
    left(machine.directory, `${String(departed())}.${String(Date.now())}`);
    const runs = await Promise.all(
      Array.from({ length: together }, () => machine.run([])),
    );
    for (const done of runs)
      assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  }
  assert.deepEqual(installation.grants, [
    "authorization_code granted",
    ...Array.from(
      { length: together * meetings },
      () => "refresh_token granted",
    ),
  ]);
  const stored = JSON.parse(machine.file("session.json") ?? "{}") as {
    readonly refreshToken?: string;
  };
  assert.ok(stored.refreshToken === installation.renewal());
});

test("what a write that was killed part-way left of the sign-in is gone after the next run", async () => {
  const { installation, machine } = await signedIn();
  const draft = `session.json.${String(departed())}.draft`;
  writeFileSync(join(machine.directory, draft), "a token being written");
  const done = await machine.run([]);
  assert.equal(done.lines[0], `site: ${installation.site}, signed in`);
  assert.deepEqual(readdirSync(machine.directory).toSorted(), [
    "lock",
    "session.json",
  ]);
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

test("a home the program cannot keep its files in is a failure that names the path, with no trace of why, and names no command to run until it can", async () => {
  const machine = made.machine();
  mkdirSync(machine.home, { recursive: true });
  writeFileSync(machine.directory, "in the way");
  for (const argv of [["--site", "http://127.0.0.1:9"], ["sign-in"]]) {
    const done = await machine.run(argv);
    assert.equal(done.code, 1);
    assert.equal(done.stderr, "");
    assert.deepEqual(done.lines.slice(0, 2), [
      `found: chuggy setup could not make or write ${machine.directory}`,
      `tell: chuggy setup stopped because it could not write ${machine.directory} on this machine. Tell me once it can.`,
    ]);
    const rule = done.lines[2] ?? "";
    assert.ok(rule.startsWith("rule: Run node "), rule);
    assert.ok(
      rule.endsWith(` only once ${machine.directory} can be made and written.`),
      rule,
    );
    assert.deepEqual(done.lines.slice(3), ["next: stop"]);
  }
  assert.equal(readFileSync(machine.directory, "utf8"), "in the way");
});

test("a home the program may read and not write names the path it could not change, whichever command is run, and nothing is asked of the site", async () => {
  const { installation, machine } = await signedIn();
  const kept = [machine.directory, join(machine.directory, "lock")];
  const asked = installation.asked.length;
  for (const path of kept) chmodSync(path, 0o500);
  try {
    for (const argv of [[], ["sign-in"]]) {
      const done = await machine.run(argv);
      assert.equal(done.code, 1);
      assert.equal(done.stderr, "");
      assert.equal(
        done.lines[0],
        `found: chuggy setup could not make or write ${kept[1] ?? ""}`,
      );
      assert.deepEqual(done.lines.slice(3), ["next: stop"]);
    }
    assert.equal(installation.asked.length, asked);
  } finally {
    for (const path of kept) chmodSync(path, 0o700);
  }
});
