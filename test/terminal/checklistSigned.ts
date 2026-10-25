/**
 * What the checklist suites run the bare setup program with: a machine signed
 * in to a stand-in installation of its own, one run against the site a case
 * sets, and what that run said.
 */

import assert from "node:assert/strict";

import type { SetupSite } from "../../ui/chuggy-ui/test/setupSite.ts";

import { dialect, making, program, shellWords, signedIn } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

interface Signed {
  readonly installation: StandIn;
  readonly machine: Home;
}

/** A machine signed in to a stand-in installation of its own, with nothing yet kept of what was asked. */
export async function signed(): Promise<Signed> {
  const installation = await made.installation();
  const machine = made.machine();
  const done = await signedIn(installation, machine);
  assert.equal(done.code, 0, done.stdout);
  installation.asked.length = 0;
  return { installation, machine };
}

/** One run against the site as `world` holds it, bare unless `argv` says more, and a report in the dialect whatever it found. */
export async function read(
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

/** The lines a run printed under `word`, without the word. */
export function said(done: Ran, word: string): readonly string[] {
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
export async function ruled(done: Ran): Promise<readonly string[]> {
  const [rule = ""] = said(done, "rule");
  assert.match(rule, ruleEnd, done.stdout);
  const command = rule.slice("Run ".length, rule.search(ruleEnd));
  const [runner, script, ...argv] = await shellWords(command);
  assert.deepEqual([runner, script], ["node", program], done.stdout);
  return argv;
}
