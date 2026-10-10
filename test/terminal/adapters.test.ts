/**
 * The two adapters `runner` reaches a machine through, against a real disk
 * and real processes: paths outside the program's own directory, and a
 * command run to its end.
 *
 * What the decisions assume of the two ports is held here against what fills
 * them. A file is made only where nothing holds its name, for its owner alone
 * as the directories made above it are. A command is waited on for no longer
 * than its bound, with everything it started ended with it, whether it is run
 * to its end or only read; what it prints is kept up to a bound and read on
 * past it; and one that ends leaving something behind that holds its output
 * is answered all the same.
 * Every child here is this suite's own Node, started by its whole path, and
 * each one a case leaves behind is ended by the case.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SetupMachineError } from "../../ui/chuggy-ui/app/core/setupPorts.ts";
import { disk } from "../../ui/chuggy-ui/terminal/disk.ts";
import { processesOf } from "../../ui/chuggy-ui/terminal/processes.ts";
import { ended, eventually, making } from "./program.ts";

const made = making();
const { read, run } = processesOf("unused");

/** A command that is this suite's Node running `script`, with `rest` as its arguments. */
function node(script: string, ...rest: readonly string[]): readonly string[] {
  return [process.execPath, "-e", script, ...rest];
}

/** Far past anything a case here waits, so a child that outlived its case would be seen to. */
const staysMs = 30_000;
const waitMs = 20_000;
const bytesMax = 4_096;

/** More than a pipe and a reader that stopped reading hold between them, so a child that prints it ends only where it is read on. */
const floodBytes = bytesMax * 4_096;

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("what is at a path is said following a link to where it points, and a path nobody can be shown is nothing there", () => {
  const { beside } = made.machine();
  writeFileSync(join(beside, "file"), "text");
  mkdirSync(join(beside, "directory"));
  symlinkSync(join(beside, "file"), join(beside, "link"));
  symlinkSync(join(beside, "nowhere"), join(beside, "dangling"));
  assert.equal(disk.kind(join(beside, "file")), "File");
  assert.equal(disk.kind(join(beside, "directory")), "Directory");
  assert.equal(disk.kind(join(beside, "link")), "File");
  assert.equal(disk.kind(join(beside, "dangling")), "None");
  assert.equal(disk.kind(join(beside, "missing")), "None");
  assert.equal(disk.kind("/dev/null"), "Other");
  assert.deepEqual(disk.names(join(beside, "missing")), []);
  assert.deepEqual(disk.names(join(beside, "file")), []);
  assert.ok(disk.names(beside).includes("directory"));
});

test("only a file is read, and only one no longer than the bound", () => {
  const { beside } = made.machine();
  const file = join(beside, "file");
  writeFileSync(file, "x".repeat(bytesMax));
  assert.equal(disk.text(file, bytesMax)?.length, bytesMax);
  assert.equal(disk.text(file, bytesMax - 1), undefined);
  assert.equal(disk.text(beside, bytesMax), undefined);
  assert.equal(disk.text(join(beside, "missing"), bytesMax), undefined);
  assert.equal(disk.text("/dev/zero", bytesMax), undefined);
});

/** Who may do what with what is at a path, as the three digits a listing shows. */
function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

test("a file is made whole, for its owner alone as each directory made above it is, whatever the person lets a new file be, and only where nothing holds its name", () => {
  const { beside } = made.machine();
  const path = join(beside, "a", "b", "made.json");
  const usual = process.umask(0);
  try {
    disk.make(path, "first");
  } finally {
    process.umask(usual);
  }
  assert.equal(readFileSync(path, "utf8"), "first");
  assert.equal(mode(path), "600");
  assert.deepEqual([join(beside, "a"), join(beside, "a", "b")].map(mode), [
    "700",
    "700",
  ]);
  assert.throws(
    () => {
      disk.make(path, "second");
    },
    (failure: unknown) =>
      failure instanceof SetupMachineError &&
      failure.fault.fault === "Unwritable" &&
      failure.fault.path === path,
  );
  assert.equal(readFileSync(path, "utf8"), "first");
  assert.deepEqual(readdirSync(join(beside, "a", "b")), ["made.json"]);
  assert.throws(() => {
    disk.make(join(path, "under-a-file"), "text");
  }, SetupMachineError);
});

test("a directory is this user's to write only where it is a directory they may make a file in", () => {
  const { beside } = made.machine();
  const sealed = join(beside, "sealed");
  mkdirSync(sealed, { mode: 0o555 });
  writeFileSync(join(beside, "file"), "");
  try {
    assert.equal(disk.writable(beside), true);
    assert.equal(disk.writable(sealed), false);
    assert.equal(disk.writable(join(beside, "file")), false);
    assert.equal(disk.writable(join(beside, "missing")), false);
  } finally {
    chmodSync(sealed, 0o755);
  }
});

test("a command run to its end is answered with what it exited with and what it printed on each stream, and is given nothing to read", async () => {
  const said = await run(
    node(
      'process.stdout.write(require("node:fs").readlinkSync("/proc/self/fd/0")); process.stderr.write("aside"); process.exitCode = 3;',
    ),
    waitMs,
    bytesMax,
  );
  assert.deepEqual(said, {
    ended: "Exited",
    exit: 3,
    out: "/dev/null",
    err: "aside",
  });
});

test("a command that is not there, or is no command at all, did not start", async () => {
  const { beside } = made.machine();
  for (const command of [[join(beside, "no-such-program")], [beside], []])
    assert.deepEqual(await run(command, waitMs, bytesMax), {
      ended: "Unstarted",
    });
});

test("what a command prints is kept up to the bound and read on past it, so one that prints more still ends", async () => {
  const said = await run(
    node(
      'process.stdout.write("o".repeat(Number(process.argv[1]))); process.stderr.write("e".repeat(Number(process.argv[1])));',
      String(floodBytes),
    ),
    waitMs,
    bytesMax,
  );
  assert.deepEqual(said, {
    ended: "Exited",
    exit: 0,
    out: "o".repeat(bytesMax),
    err: "e".repeat(bytesMax),
  });
});

/** A script that starts another Node that stays, writes that one's number down, and then does what `then` says. */
function leaving(noted: string, then: string): readonly string[] {
  return node(
    `const left = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => undefined, ${String(staysMs)})"], { stdio: "inherit" }); require("node:fs").writeFileSync(process.argv[1], String(left.pid)); ${then}`,
    noted,
  );
}

/** What `through` answers of a command that starts another and then does what `then` says, once the one it started is seen to have gone with it. */
async function outlasted<T>(
  then: string,
  through: (command: readonly string[]) => Promise<T>,
): Promise<T> {
  const noted = join(made.machine().beside, "left.pid");
  const left = (): number => Number(readFileSync(noted, "utf8"));
  const began = Date.now();
  try {
    const said = await through(leaving(noted, then));
    assert.ok(Date.now() - began < staysMs / 2);
    await eventually(() => (running(left()) ? undefined : true));
    return said;
  } finally {
    if (existsSync(noted)) ended(left());
  }
}

const stays = `setTimeout(() => undefined, ${String(staysMs)});`;

test("a command still running at its bound is ended with everything it started, and the answer is that it did not end", async () => {
  assert.deepEqual(
    await outlasted(stays, (command) => run(command, 1_000, bytesMax)),
    { ended: "Unended" },
  );
});

test("a command whose answer is read and that is still running at its bound, or prints past the length read, is ended with everything it started and has no answer", async () => {
  assert.equal(
    await outlasted(stays, (command) => read(command, 1_000, bytesMax)),
    undefined,
  );
  assert.equal(
    await outlasted(
      `process.stdout.write("o".repeat(${String(bytesMax + 1)})); ${stays}`,
      (command) => read(command, waitMs, bytesMax),
    ),
    undefined,
  );
});

test("a command whose answer is read is given nothing to read and a session of its own, and what it prints is its answer only where it ends well within the length read", async () => {
  const asked =
    'const stat = require("node:fs").readFileSync("/proc/self/stat", "utf8"); process.stdout.write(require("node:fs").readlinkSync("/proc/self/fd/0") + " " + String(Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[3]) === process.pid));';
  assert.equal(await read(node(asked), waitMs, bytesMax), "/dev/null true");
  assert.equal(
    await read(node(`${asked} process.exitCode = 1;`), waitMs, bytesMax),
    undefined,
  );
  const filled = 'process.stdout.write("o".repeat(Number(process.argv[1])));';
  assert.equal(
    await read(node(filled, String(bytesMax)), waitMs, bytesMax),
    "o".repeat(bytesMax),
  );
  assert.equal(
    await read(node(filled, String(bytesMax + 1)), waitMs, bytesMax),
    undefined,
  );
});

test("a command that ends leaving something behind that holds its output open is answered once it has ended, and not when what it left lets go", async () => {
  const noted = join(made.machine().beside, "left.pid");
  const left = (): number => Number(readFileSync(noted, "utf8"));
  const began = Date.now();
  try {
    const said = await run(
      leaving(noted, 'left.unref(); process.stdout.write("done");'),
      waitMs,
      bytesMax,
    );
    assert.deepEqual(said, { ended: "Exited", exit: 0, out: "done", err: "" });
    assert.ok(Date.now() - began < staysMs / 2);
    assert.ok(running(left()));
  } finally {
    if (existsSync(noted)) ended(left());
  }
});
