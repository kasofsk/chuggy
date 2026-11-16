/**
 * The North Star step: offered after the project's, drafted from the folder
 * where its checkout tracks files and from one question where it does not,
 * and written by `north-star` into the project's settings with every other
 * override kept.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import { setupAnswersNone } from "../app/core/setupArguments.ts";
import { setupNext } from "../app/core/setupNext.ts";
import {
  setupTrackedBytesMax,
  setupTrackedCommand,
  setupTrackedRead,
} from "../app/core/setupNorthStar.ts";
import type { SetupTracked } from "../app/core/setupNorthStar.ts";
import type {
  SetupChildEnded,
  SetupProcessPort,
} from "../app/core/setupPorts.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import type { SetupStanding } from "../app/core/setupStanding.ts";
import { selectorSettingsTextCharsMax } from "../../../src/contract/http.ts";
import {
  machineProject,
  machineScript,
  machineServing,
  machineSignedIn,
  machineWrites,
} from "./setupMachine.ts";
import { setupSiteAt } from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";
import { stoodSite } from "./setupStood.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const text = "Widgets that work end to end soon, for a demo or two.";
const kept = { threadStandingRules: "Say what you ran." };
const settings = "/api/v1/tenants/acme/projects/widgets/selector-settings";
const ask =
  "Ask the person one question: is this a demo for one or a few tries, or software they will keep and maintain?";

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

function step(said: readonly string[], name: string): string | undefined {
  return said.find((line) => line.startsWith(`step: ${name} `));
}

/** A site set up to its project, whose settings hold an override but no North Star. */
function starless(): SetupSite {
  const site = setupSiteAt("Project");
  const only = site.projects[0];
  if (only === undefined) throw new Error("no project");
  only.overrides = kept;
  return site;
}

function answering(ended: SetupChildEnded): {
  readonly process: SetupProcessPort;
  readonly asked: unknown[][];
} {
  const asked: unknown[][] = [];
  const refused = (): never => {
    throw new Error("git is asked once and nothing else is run");
  };
  return {
    asked,
    process: {
      pid: 1,
      alive: refused,
      detach: refused,
      launch: refused,
      read: refused,
      run: (...given) => {
        asked.push(given);
        return Promise.resolve(ended);
      },
    },
  };
}

const exited = (exit: number, out: string): SetupChildEnded => ({
  ended: "Exited",
  exit,
  out,
  err: "",
});

test("git is asked once for the files the folder's checkout tracks, within a bound on what it prints, and a checkout tracking any is told from one tracking none and from none at all", async () => {
  const { process, asked } = answering(exited(0, "README.md\0src/a.ts\0"));
  expect(await setupTrackedRead(process, 5_000)).toBe("Files");
  expect(asked).toEqual([[setupTrackedCommand, 5_000, setupTrackedBytesMax]]);
  expect(setupTrackedCommand).toEqual(["git", "ls-files", "-z"]);
  const cases: readonly (readonly [SetupChildEnded, SetupTracked])[] = [
    [exited(0, "READ"), "Files"],
    [exited(0, ""), "None"],
    [exited(128, ""), "Unread"],
    [{ ended: "Unstarted" }, "Unread"],
    [{ ended: "Unended" }, "Unread"],
  ];
  for (const [ended, tracked] of cases)
    expect(
      await setupTrackedRead(answering(ended).process, 5_000),
      JSON.stringify(ended),
    ).toBe(tracked);
});

/** A standing whose first step not done lacks a North Star. */
const lacking: SetupStanding = {
  site: stoodSite,
  choice: { choice: "Made", by: "Only", workspace: "acme", project: "widgets" },
  remote: undefined,
  workspaces: [],
  found: [],
  steps: [
    { step: "project", state: "done", detail: "", lacks: undefined },
    {
      step: "north-star",
      state: "todo",
      detail: "",
      lacks: { lacks: "NorthStar" },
    },
  ],
  unmerged: undefined,
  bootstrap: undefined,
};

function offered(tracked: SetupTracked | undefined): readonly string[] {
  const next = setupNext(
    lacking,
    setupAnswersNone,
    "linux",
    undefined,
    undefined,
    undefined,
    undefined,
    tracked,
  );
  return lines({
    report: "Checklist",
    site: stoodSite,
    found: [],
    steps: [],
    next,
  });
}

test("where the folder's checkout tracks files, the North Star is offered as drafted from the folder, steelmanned, with the question as the way where the folder holds too little", () => {
  const said = offered("Files");
  expect(said.slice(-4)).toEqual([
    "tell: Every agent chuggy runs for this project reads its North Star: what the project is for and what to favour. I can draft one from this folder's code, for you to change or say yes to, or we can skip it.",
    `rule: Run node ${machineScript} north-star ${at} with --text and the North Star, quoted as one word, only once the person has said yes to it or to their changes of it. To write it: Read this folder, its README, code, tests and docs, and draft the North Star as one short paragraph: the strongest reading of what the project is for, who it serves and what its work should favour, steelmanned and not hedged. Where the folder holds too little to read a purpose from, do this instead: ${ask} Write a short North Star from the answer: a demo favours working end to end soon over structure and polish, and maintained software favours clear structure, tests and docs that let later changes go in safely. Show it to the person for a yes or their changes before running anything.`,
    `rule: Run node ${machineScript} ${at} --north-star skip only if the person would rather go on without a North Star.`,
    "next: stop",
  ]);
});

test("where the folder tracks no file, is no checkout, or git did not answer, the North Star is offered from one question: a demo, or software to keep and maintain", () => {
  for (const tracked of ["None", "Unread", undefined] as const) {
    const said = offered(tracked);
    const [tell, rule] = said.slice(-4);
    expect(tell, tracked).toBe(
      "tell: Every agent chuggy runs for this project reads its North Star: what the project is for and what to favour. I can write a short one from your answer to one question, or we can skip it.",
    );
    expect(rule, tracked).toContain(`To write it: ${ask} `);
    expect(rule, tracked).not.toContain("Read this folder");
  }
});

test("after the project, the checklist offers the North Star, having asked git of the folder, and neither sends the person to the browser nor writes anything", async () => {
  const machine = await machineSignedIn(starless());
  machine.launched.length = 0;
  const said = lines(await machine.command(flags));
  expect(step(said, "north-star")).toBe(
    "step: north-star  todo     the project has no North Star yet",
  );
  expect(said.at(-3)).toMatch(
    new RegExp(
      `^rule: Run node ${machineScript} north-star ${at} with --text `,
      "u",
    ),
  );
  expect(said.slice(1).some((line) => line.includes("http"))).toBe(false);
  expect(machine.box.ran).toContainEqual(setupTrackedCommand);
  expect(machine.launched).toEqual([]);
  expect(machineWrites(machine)).toEqual([]);
});

test("north-star writes the North Star under the revision read, keeping every other override, never prints it back, and the checklist read after has the step done", async () => {
  const machine = await machineSignedIn(starless());
  const report = await machine.command([
    "north-star",
    ...flags,
    "--text",
    text,
  ]);
  const said = lines(report);
  expect(said[1]).toBe("did: wrote the North Star of acme/widgets");
  expect(step(said, "north-star")).toBe(
    "step: north-star  done     the project has a North Star",
  );
  expect(said.some((line) => line.includes(text))).toBe(false);
  expect(machineWrites(machine)).toEqual([`PUT ${settings}`]);
  expect(machineProject(machine).overrides).toEqual({
    ...kept,
    northStar: text,
  });
  expect(setupReportExit(report)).toBe(0);
});

test("a write the revision moved under is read again and written once more, and a second is said as not written, with the settings left as they were", async () => {
  const once = await machineSignedIn(starless());
  machineProject(once).races = 1;
  const said = lines(
    await once.command(["north-star", ...flags, "--text", text]),
  );
  expect(said[1]).toBe("did: wrote the North Star of acme/widgets");
  expect(machineWrites(once)).toEqual([`PUT ${settings}`, `PUT ${settings}`]);
  expect(machineProject(once).overrides).toEqual({ ...kept, northStar: text });

  const twice = await machineSignedIn(starless());
  machineProject(twice).races = 2;
  const refused = lines(
    await twice.command(["north-star", ...flags, "--text", text]),
  );
  expect(refused[1]).toMatch(
    /^found: chuggy did not write the North Star of acme\/widgets: \S/u,
  );
  expect(machineWrites(twice)).toEqual([`PUT ${settings}`, `PUT ${settings}`]);
  expect(machineProject(twice).overrides).toEqual(kept);
  expect(step(refused, "north-star")).toBe(
    "step: north-star  todo     the project has no North Star yet",
  );
});

test("a write the site refuses is said as not written, and writes nothing", async () => {
  const machine = await machineSignedIn(starless());
  machine.world.fates.set("star", "Failed");
  const said = lines(
    await machine.command(["north-star", ...flags, "--text", text]),
  );
  expect(said[1]).toMatch(
    /^found: chuggy did not write the North Star of acme\/widgets: \S/u,
  );
  expect(machineProject(machine).overrides).toEqual(kept);
});

test("a North Star longer than the settings take is refused before anything is sent", async () => {
  const machine = await machineSignedIn(starless());
  machine.sent.length = 0;
  const report = await machine.command([
    "north-star",
    ...flags,
    "--text",
    "w".repeat(selectorSettingsTextCharsMax + 1),
  ]);
  expect(report).toEqual({ report: "AskedWrongly", fault: "NorthStarText" });
  expect(machine.sent).toEqual([]);
});

test("where the project has a North Star the step is done and not asked again, and north-star writes nothing", async () => {
  const machine = await machineSignedIn(setupSiteAt("Project"));
  const said = lines(await machine.command(flags));
  expect(step(said, "north-star")).toBe(
    "step: north-star  done     the project has a North Star",
  );
  expect(said.some((line) => /^(?:rule|next): .*north-star/u.test(line))).toBe(
    false,
  );
  expect(machine.box.ran).not.toContainEqual(setupTrackedCommand);
  const again = lines(
    await machine.command(["north-star", ...flags, "--text", text]),
  );
  expect(again[1]).toBe(
    "found: nothing to write: the next thing is not the project's North Star",
  );
  expect(machineWrites(machine)).toEqual([]);
});

test("passed over with --north-star skip, the step is done, nothing is written, and every command printed carries the skip", async () => {
  const machine = await machineSignedIn(starless());
  const said = lines(await machine.command([...flags, "--north-star", "skip"]));
  expect(step(said, "north-star")).toBe(
    "step: north-star  done     passed over without a North Star",
  );
  const named = said.filter(
    (line) =>
      line.startsWith(`next: node `) || line.startsWith("rule: Run node "),
  );
  expect(named.length).toBeGreaterThan(0);
  for (const line of named) expect(line).toMatch(/ --north-star skip(?: |$)/u);
  expect(machineWrites(machine)).toEqual([]);
  expect(machineProject(machine).overrides).toEqual(kept);
});
