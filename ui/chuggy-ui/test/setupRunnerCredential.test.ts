/**
 * The runner step on a machine whose runner has no Claude credential: the one
 * opening that asks for the path of one, of either kind, and offers another
 * machine; `runner` copying the file named and changing nothing where it is
 * not taken; and a machine already holding one never asked for it. No case
 * where the machine fits says a memory, Colima or a file mode, and no line
 * holds what the file named holds.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersAsked } from "../app/core/setupArguments.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import { machineScript, machineSignedIn, machineSite } from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  boxApiKey,
  boxFolder,
  boxLogin,
  boxLoginSecret,
  boxSettings,
} from "./setupRunnerBox.ts";
import { setupSiteAt } from "./setupSite.ts";

const flags = "--workspace acme --project widgets";
const runner = ["runner", ...flags.split(" ")];
const token = "sk-ant-oat01-named-by-path-never-said";
const apiKey = "sk-ant-api03-named-by-path-never-said";
const tokenFile = `${boxFolder}/claude-token`;
const apiKeyFile = `${boxFolder}/api-key`;
/** What no line said where the machine fits may hold. */
const unsaid = /GiB|MiB|Colima|mode 600/u;

/** A machine signed in to a site that lacks only a runner, chats on a chat host where `chats`, its runner holding no credential, and the person's files of each kind in the folder. */
async function bare(chats = false): Promise<SetupMachine> {
  const site = setupSiteAt("Configured");
  for (const project of site.projects)
    project.threads = chats ? "Pool" : "InCluster";
  const machine = await machineSignedIn(site);
  machine.box.paths.delete(boxLogin);
  machine.box.paths.set(tokenFile, `${token}\n`);
  machine.box.paths.set(apiKeyFile, apiKey);
  return machine;
}

/** One command's lines, none holding a secret the doubles or the person's files hold. */
async function said(
  machine: SetupMachine,
  argv: readonly string[] = [],
): Promise<{ readonly exit: number; readonly lines: readonly string[] }> {
  const report = await machine.command(argv);
  const lines = setupReportLines(
    report,
    machineScript,
    copyTextEn,
    setupAnswersAsked(argv),
  );
  const text = lines.join("\n");
  for (const secret of [
    ...machine.world.secrets,
    ...machine.issued,
    boxLoginSecret,
    token,
    apiKey,
  ])
    expect(text).not.toContain(secret);
  return { exit: setupReportExit(report), lines };
}

function tells(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.startsWith("tell: "));
}

const elsewhere = (things: string, host: string) =>
  `rule: Where the person wants them on another machine instead, run nothing here, and give them this line to paste into Claude Code on that machine: Make this machine my chuggy ${things}: run "curl -fsS ${machineSite}/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs runner --site ${machineSite} ${flags}${host}" and do what its output says.`;

test("a machine with no credential is told once what the step sets up, that it needs a token or an API key, to point to it, and that it can be another machine, and is told no memory, Colima or file mode", async () => {
  const cases = [
    {
      chats: true,
      tell: "tell: Now let's set up your chat host and a runner. The chat host will power your chat in the chuggy web app, and the runner will run your work. You'll need a token from `claude setup-token` or an Anthropic API key. Point me to it and I'll set these up on this machine. If you want them hosted elsewhere, let me know.",
      other: elsewhere("runner and chat host", " --chat-host yes"),
    },
    {
      chats: false,
      tell: "tell: Now let's set up a runner, which will run your work. You'll need a token from `claude setup-token` or an Anthropic API key. Point me to it and I'll set it up on this machine. If you want it hosted elsewhere, let me know.",
      other: elsewhere("runner", ""),
    },
  ];
  for (const { chats, tell, other } of cases) {
    const machine = await bare(chats);
    const before = new Map(machine.box.paths);
    const { exit, lines } = await said(machine);
    expect(exit).toBe(0);
    expect(lines.slice(-4)).toEqual([
      tell,
      `rule: Run node ${machineScript} runner ${flags} --claude-token-file or node ${machineScript} runner ${flags} --anthropic-api-key-file, followed by the path of that file, only once the person points you to the file of a token from \`claude setup-token\`, with the first, or of an Anthropic API key, with the second, and has not asked for it on another machine instead. Never read, copy or move the file yourself, and never say what is in it.`,
      other,
      "next: stop",
    ]);
    expect(tells(lines).join("\n")).not.toMatch(unsaid);
    expect(machine.box.paths).toEqual(before);
  }
});

test("a token's path or an API key's is copied to the runner's place for its kind, the file named is left alone and unnamed, and the step then offers the install without asking again, the run it names writing settings that name the copy as its kind", async () => {
  const cases = [
    {
      flag: "--claude-token-file",
      given: tokenFile,
      file: tokenFile,
      held: `${token}\n`,
      at: boxLogin,
      other: boxApiKey,
      did: `did: put your Claude login in ${boxLogin}, readable only by you (mode 600)`,
      named: { claudeTokenFile: boxLogin },
      on: "on your Claude plan.",
    },
    {
      flag: "--anthropic-api-key-file",
      given: "api-key",
      file: apiKeyFile,
      held: `${apiKey}\n`,
      at: boxApiKey,
      other: boxLogin,
      did: `did: put your Anthropic API key in ${boxApiKey}, readable only by you (mode 600)`,
      named: { claudeCredential: { kind: "ApiKey", apiKeyFile: boxApiKey } },
      on: "on your Anthropic API key.",
    },
  ];
  for (const { flag, given, file, held, at, other, did, named, on } of cases) {
    const machine = await bare();
    const before = machine.box.paths.get(file);
    const placed = await said(machine, [...runner, flag, given]);
    expect(placed.exit).toBe(0);
    expect(placed.lines.slice(-2)).toEqual([
      did,
      `next: node ${machineScript} ${flags}`,
    ]);
    expect(placed.lines.join("\n")).not.toContain(file);
    expect(machine.box.paths.get(at)).toBe(held);
    expect(machine.box.paths.has(other)).toBe(false);
    expect(machine.box.paths.has(boxSettings)).toBe(false);
    expect(machine.box.paths.get(file)).toBe(before);
    expect(machine.box.acts).not.toContain("register");

    const offered = await said(machine);
    const [tell] = tells(offered.lines).slice(-1);
    expect(tell).toMatch(/^tell: I'll install your runner on this machine/u);
    expect(tell).toContain(on);
    expect(tells(offered.lines).join("\n")).not.toMatch(
      /Now let's|setup-token|Point me|mode 600|GiB|MiB|Colima/u,
    );
    expect(offered.lines.at(-3)).toBe(
      `rule: Run node ${machineScript} runner ${flags} only once the person has been told what it does here, has not objected, and has not asked for it on another machine instead.`,
    );

    expect((await said(machine, runner)).exit).toBe(0);
    expect(JSON.parse(machine.box.paths.get(boxSettings) ?? "")).toMatchObject(
      named,
    );
    expect(machine.box.acts).toContain("register");
  }
});

test("a path with nothing there, an empty file, a directory, or a file of the other kind is refused in one sentence with nothing changed, and the step still asks for a path", async () => {
  const cases = [
    {
      argv: ["--claude-token-file", `${boxFolder}/missing`],
      tell: "There is no file there, so nothing was changed",
    },
    {
      argv: ["--claude-token-file", `${boxFolder}/empty`],
      tell: "That file is empty, so nothing was changed",
    },
    {
      argv: ["--anthropic-api-key-file", `${boxFolder}/a-directory`],
      tell: "There is no file there, so nothing was changed",
    },
    {
      argv: ["--claude-token-file", apiKeyFile],
      tell: "That file holds no token from `claude setup-token`, so nothing was changed",
    },
    {
      argv: ["--anthropic-api-key-file", tokenFile],
      tell: "That file holds no Anthropic API key, so nothing was changed",
    },
  ];
  for (const { argv, tell } of cases) {
    const machine = await bare();
    machine.box.paths.set(`${boxFolder}/empty`, " \n");
    machine.box.paths.set(`${boxFolder}/a-directory`, undefined);
    const before = new Map(machine.box.paths);
    const { exit, lines } = await said(machine, [...runner, ...argv]);
    expect(exit).toBe(0);
    expect(tells(lines)).toEqual([
      `tell: ${tell}; tell me when you have the right path.`,
    ]);
    expect(lines.slice(-2)).toEqual([
      `rule: Run node ${machineScript} ${flags} only once the person gives you another path.`,
      "next: stop",
    ]);
    expect(machine.box.paths).toEqual(before);
    expect(machine.box.acts).not.toContain("register");
    expect(tells((await said(machine)).lines).at(-1)).toMatch(
      /^tell: Now let's set up a runner/u,
    );
  }
});

test("a machine that already holds the runner's credential, as a token or as an API key, is never asked for one, and a path given anyway is not read or copied", async () => {
  for (const [at, other] of [
    [boxLogin, boxApiKey],
    [boxApiKey, boxLogin],
  ] as const) {
    const machine = await bare();
    machine.box.paths.set(at, boxLoginSecret);
    const offered = await said(machine);
    expect(tells(offered.lines).join("\n")).not.toMatch(
      /Now let's|setup-token|Point me|GiB|MiB|Colima|mode 600/u,
    );
    expect(tells(offered.lines).at(-1)).toMatch(
      /^tell: I'll install your runner on this machine/u,
    );
    const before = new Map(machine.box.paths);
    const { exit } = await said(machine, [
      ...runner,
      "--claude-token-file",
      tokenFile,
    ]);
    expect(exit).toBe(0);
    expect(machine.box.paths).toEqual(before);
    expect(machine.box.paths.has(other)).toBe(false);
    expect(machine.box.read).not.toContain(tokenFile);
  }
});
