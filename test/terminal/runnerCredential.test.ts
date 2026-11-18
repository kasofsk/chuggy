/**
 * `runner` handed the path of a Claude credential, on a real disk, on a
 * machine holding none: the copy it makes is the person's alone in a
 * directory that is too, the file named is left as it was, the settings the
 * run the person then agrees to writes name the copy as the kind it is, and
 * no line holds what is in it.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { type Stood, flags, ran, runnerAlone, stood } from "./runnerStood.ts";

function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

/** A machine whose runner has no Claude login, nor the directory it would be in, and a file of the person's beside it holding `secret`. */
async function handed(secret: string): Promise<{ on: Stood; given: string }> {
  const on = await stood();
  rmSync(dirname(on.machine.login), { recursive: true });
  const given = join(on.home.beside, "credential");
  writeFileSync(given, `${secret}\n`, { mode: 0o644 });
  return { on, given };
}

const cases = [
  {
    flag: "--claude-token-file",
    secret: "sk-ant-oat01-handed-by-path-never-said",
    placed: (on: Stood) => on.machine.login,
    named: (at: string) => ({ claudeTokenFile: at }),
  },
  {
    flag: "--anthropic-api-key-file",
    secret: "sk-ant-api03-handed-by-path-never-said",
    placed: (on: Stood) => join(dirname(on.machine.login), "api-key"),
    named: (at: string) => ({
      claudeCredential: { kind: "ApiKey", apiKeyFile: at },
    }),
  },
] as const;

for (const { flag, secret, placed, named } of cases)
  test(`${flag} copies the file into the runner's own place, readable only by the person, leaves the file named as it was, has the settings the run then writes name it as its kind, and says nothing of what is in it`, async () => {
    const { on, given } = await handed(secret);
    const done = await ran(on, [...runnerAlone, flag, given]);
    assert.equal(done.code, 0, done.stdout);
    assert.ok(!done.stdout.includes(secret), done.stdout);
    assert.ok(!done.stdout.includes(given), done.stdout);
    assert.match(
      done.stdout,
      /^next: node \S+ --workspace acme --project widgets$/mu,
    );

    const at = placed(on);
    assert.equal(readFileSync(at, "utf8"), `${secret}\n`);
    assert.deepEqual([mode(at), mode(dirname(at))], ["600", "700"]);
    assert.equal(existsSync(on.machine.settings), false);
    assert.equal(readFileSync(given, "utf8"), `${secret}\n`);
    assert.equal(mode(given), "644");

    const offered = await ran(on, flags.split(" "));
    assert.equal(offered.code, 0, offered.stdout);
    assert.match(
      offered.stdout,
      /^tell: I'll install your runner on this machine/mu,
    );
    const installed = await ran(on, runnerAlone);
    assert.equal(installed.code, 0, installed.stdout);
    for (const done of [offered, installed])
      assert.ok(!done.stdout.includes(secret), done.stdout);
    const settings = JSON.parse(
      readFileSync(on.machine.settings, "utf8"),
    ) as Record<string, unknown>;
    for (const [key, value] of Object.entries(named(at)))
      assert.deepEqual(settings[key], value);
    assert.equal(
      Object.hasOwn(settings, "claudeTokenFile"),
      flag === "--claude-token-file",
    );
  });
