/**
 * The person's own usage before their first ticket and while it waits: a
 * window at or over its threshold is told with the threshold offered in its
 * place, and `usage` raises it on their yes; a window too near its whole, or
 * the provider's own limit, is told without an offer; their no is said once
 * and never asked again; and a person under both thresholds, or with no
 * reading, is told nothing.
 *
 * @vitest-environment node
 */

import { expect, test } from "vitest";

import type { AgentAccount } from "../../../src/contract/responses.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyOrDataText } from "../app/core/copy.ts";
import { instantText } from "../app/core/figures.ts";
import { setupReportExit, setupReportLines } from "../app/core/setupReport.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import { setupUsageOf, setupUsageOffered } from "../app/core/setupUsage.ts";
import {
  machineScript,
  machineServing,
  machineSignedIn,
  machineWrites,
} from "./setupMachine.ts";
import type { SetupMachine } from "./setupMachine.ts";
import {
  setupSiteAccountOf,
  setupSiteAt,
  setupSiteClaude,
  setupSiteWaiting,
} from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

const flags = ["--workspace", "acme", "--project", "widgets"];
const at = flags.join(" ");
const program = `node ${machineScript}`;
const hourMs = 3_600_000;
const startMs = 1_000_000;
const resetsMs = startMs + hourMs;
const iso = (ms: number): string => new Date(ms).toISOString();
const brief =
  "ask: What would you like done first in acme/widgets? Say it in a sentence or two, or ask me to suggest something small from this repository. I will make it a ticket and start it. If you would rather write it yourself: Open https://chuggy.example/acme/widgets/tickets/new, say what you want done and press Create ticket.";
const write = "PUT /api/v1/agent-accounts/Claude/settings";
const declined = (then: string): string =>
  `rule: Run ${program} ${then}--usage keep only if the person says no, without asking again, once you have told them in one sentence that their first ticket will wait until their usage falls under where chuggy pauses their work.`;
const accepted = (percents: string): string =>
  `rule: Run ${program} usage ${at} ${percents} only once the person says yes, with the figure they name in place of the one offered where they name another.`;

type Reading = AgentAccount["readings"][number];

function reading(window: Reading["window"], utilization: number): Reading {
  return {
    window,
    utilization,
    resetsAt: iso(resetsMs),
    observedAt: iso(startMs - 1),
  };
}

function lines(report: SetupReport): readonly string[] {
  return setupReportLines(report, machineScript, copyTextEn, machineServing);
}

/** What a run says after its steps: the ticket step and whatever follows it. */
function after(report: SetupReport): readonly string[] {
  const said = lines(report);
  return said.slice(
    said.findIndex((line) => line.startsWith("step: ticket")) + 1,
  );
}

/** A site with a live runner and its first ticket due, the person's Claude account held as `held` says. */
function due(held: Partial<Omit<AgentAccount, "agent">> = {}): SetupSite {
  return setupSiteClaude(setupSiteAt("Live"), held);
}

function resets(): string {
  return copyOrDataText(
    copyTextEn,
    instantText(new Date(resetsMs), new Date(startMs)),
  );
}

async function bare(site: SetupSite): Promise<{
  readonly machine: SetupMachine;
  readonly said: readonly string[];
}> {
  const machine = await machineSignedIn(site);
  return { machine, said: after(await machine.command(flags)) };
}

test.each([
  [
    "under both thresholds",
    [reading("five_hour", 0.79), reading("seven_day", 0.89)],
  ],
  ["with no reading", []],
  [
    "over a threshold whose window has reset",
    [{ ...reading("five_hour", 0.97), resetsAt: iso(startMs) }],
  ],
] as const)(
  "a person %s is told nothing of their usage, and asked for their first ticket",
  async (_, readings) => {
    const { machine, said } = await bare(due({ readings: [...readings] }));
    expect(said[0]).toBe(brief);
    expect(said.join("\n")).not.toMatch(/limit|threshold|usage/u);
    expect(machineWrites(machine)).toEqual([]);
  },
);

test("another agent's account over its threshold is not the person's runner's, and is told nothing", async () => {
  const site = due();
  site.accounts[1] = setupSiteAccountOf("Codex", {
    readings: [reading("five_hour", 0.9)],
  });
  expect((await bare(site)).said[0]).toBe(brief);
});

test("a usage read the site fails says nothing, and the first ticket is still asked for", async () => {
  const site = due({ readings: [reading("five_hour", 0.83)] });
  site.fates.set("usage", "Failed");
  expect((await bare(site)).said[0]).toBe(brief);
});

test.each([
  [
    "its 5-hour window",
    [reading("five_hour", 0.83), reading("seven_day", 0.4)],
    "ask: Your Claude plan is at 83% of its 5-hour limit, and chuggy pauses your work at 80%, so your tickets won't run right now. I can raise that to 90% so they do. Want me to?",
    "--five-hour-percent 90",
  ],
  [
    "its weekly window",
    [reading("five_hour", 0.1), reading("seven_day", 0.9)],
    "ask: Your Claude plan is at 90% of its weekly limit, and chuggy pauses your work at 90%, so your tickets won't run right now. I can raise that to 95% so they do. Want me to?",
    "--seven-day-percent 95",
  ],
  [
    "both windows, in one message",
    [reading("five_hour", 0.806), reading("seven_day", 0.912)],
    "ask: Your Claude plan is at 80% of its 5-hour limit and 91% of its weekly limit, and chuggy pauses your work at 80% and 90%, so your tickets won't run right now. I can raise those to 85% and 100% so they do. Want me to?",
    "--five-hour-percent 85 --seven-day-percent 100",
  ],
] as const)(
  "a person over the threshold of %s before their first ticket is told the window, the reading, the threshold and the one offered, and asked before anything is written",
  async (_, readings, ask, percents) => {
    const { machine, said } = await bare(due({ readings: [...readings] }));
    expect(said).toEqual([
      ask,
      accepted(percents),
      declined(`${at} `),
      "next: stop",
    ]);
    expect(machineWrites(machine)).toEqual([]);
  },
);

test("a window whose reading is too near all of it is told with when it resets and that the ticket starts by itself then, and nothing is offered", async () => {
  const { said } = await bare(
    due({ readings: [reading("five_hour", 0.97), reading("seven_day", 0.92)] }),
  );
  expect(said.slice(0, 2)).toEqual([
    `tell: Your Claude plan is at 97% of its 5-hour limit, too near all of it for a ticket to finish under any threshold, so raising where chuggy pauses your work would not help. That limit resets at ${resets()}, and your tickets will start by themselves then.`,
    brief,
  ]);
  expect(said.join("\n")).not.toMatch(/ usage /u);
});

test.each([
  [
    "a reopening it names",
    { window: "five_hour", resetsAt: iso(resetsMs), observedAt: iso(startMs) },
    (): string =>
      `It lifts at ${resets()}, and your tickets will start by themselves then.`,
  ],
  [
    "no reopening",
    { observedAt: iso(startMs) },
    (): string => "Your tickets will start by themselves once it lifts.",
  ],
] as const)(
  "a provider's own limit, with %s, is told as no threshold of chuggy's, with when it lifts where that is known, and nothing is offered",
  async (_, limit, lifts) => {
    const { said } = await bare(
      due({
        readings: [reading("five_hour", 0.83)],
        limit,
        pause: { until: iso(resetsMs), reasons: ["limit"], pressed: false },
      }),
    );
    expect(said.slice(0, 2)).toEqual([
      `tell: Your Claude plan has reached a limit of its own, not where chuggy pauses your work, so raising that would not help. ${lifts()}`,
      brief,
    ]);
  },
);

test("on a yes, `usage` writes the raised threshold with every other setting as it was read, says so, and goes on to the first ticket", async () => {
  const site = due({
    settings: {
      fiveHourPercent: 80,
      sevenDayPercent: 70,
      pausesThreads: false,
    },
    readings: [reading("five_hour", 0.83), reading("seven_day", 0.2)],
  });
  const machine = await machineSignedIn(site);
  const report = await machine.command([
    "usage",
    ...flags,
    "--five-hour-percent",
    "90",
  ]);
  expect(machineWrites(machine)).toEqual([write]);
  expect(site.settingsWritten).toEqual([
    {
      agent: "Claude",
      settings: {
        fiveHourPercent: 90,
        sevenDayPercent: 70,
        pausesThreads: false,
      },
      body: { fiveHourPercent: 90, sevenDayPercent: 70, pausesThreads: false },
    },
  ]);
  const said = lines(report);
  expect(said[1]).toBe(
    "did: chuggy now pauses your work at 90% of your Claude plan's 5-hour limit",
  );
  expect(after(report)[0]).toBe(brief);
  expect(setupReportExit(report)).toBe(0);
});

test("a person who names another figure has that one written in place of the one offered", async () => {
  const site = due({ readings: [reading("seven_day", 0.91)] });
  const machine = await machineSignedIn(site);
  await machine.command(["usage", ...flags, "--seven-day-percent", "98"]);
  expect(site.settingsWritten.map((each) => each.settings)).toEqual([
    { fiveHourPercent: 80, sevenDayPercent: 98, pausesThreads: true },
  ]);
});

test("a figure the settings do not take is refused by their own bounds, and nothing is written", async () => {
  const site = due({ readings: [reading("five_hour", 0.83)] });
  const machine = await machineSignedIn(site);
  const said = lines(
    await machine.command(["usage", ...flags, "--five-hour-percent", "101"]),
  );
  expect(said[1]).toMatch(
    /^found: chuggy did not change where it pauses your work: /u,
  );
  expect(machineWrites(machine)).toEqual([]);
});

test.each([
  ["no threshold", ["usage", ...flags]],
  [
    "a figure that is no whole number",
    ["usage", ...flags, "--five-hour-percent", "9.5"],
  ],
] as const)(
  "`usage` with %s is not read, and nothing is written",
  async (_, argv) => {
    const machine = await machineSignedIn(due());
    const report = await machine.command(argv);
    expect(setupReportExit(report)).toBe(2);
    expect(machineWrites(machine)).toEqual([]);
  },
);

test("on a no, the person is told once that the ticket waits, and the run that carries it on never asks again", async () => {
  const site = due({ readings: [reading("five_hour", 0.83)] });
  const machine = await machineSignedIn(site);
  const asked = after(await machine.command(flags));
  const no = asked.filter((line) => line.includes("says no"));
  expect(no).toEqual([declined(`${at} `)]);
  expect(no[0]?.match(/told them in one sentence/gu)).toHaveLength(1);

  const kept = after(await machine.command([...flags, "--usage", "keep"]));
  expect(kept[0]).toBe(brief);
  expect(kept.join("\n")).not.toMatch(/Want me to\?|says no/u);
  expect(kept[1]).toMatch(
    /ticket --workspace acme --project widgets --usage keep with --title/u,
  );
  expect(machineWrites(machine)).toEqual([]);
});

/** A site whose first ticket waits on the person's live runner, held by a pause of their account on its 5-hour window. */
function waiting(): SetupSite {
  const pause = {
    until: iso(resetsMs),
    reasons: ["five_hour" as const],
    pressed: false,
  };
  const site = setupSiteClaude(setupSiteAt("Moving"), {
    readings: [reading("five_hour", 0.83)],
    pause,
  });
  site.projects[0]?.executions.set(1, [
    setupSiteWaiting(1, "Live", undefined, pause),
  ]);
  return site;
}

test("a first ticket waiting because the person's account paused on usage gives the same alert, and the no goes on watching it", async () => {
  const { machine, said } = await bare(waiting());
  expect(said).toEqual([
    "ask: Your Claude plan is at 83% of its 5-hour limit, and chuggy pauses your work at 80%, so your tickets won't run right now. I can raise that to 90% so they do. Want me to?",
    accepted("--five-hour-percent 90"),
    declined(`watch ${at} `),
    "next: stop",
  ]);
  const kept = after(
    await machine.command(["watch", ...flags, "--usage", "keep"]),
  );
  expect(kept[0]).toBe(
    "tell: Ticket 1 is in Work. It is waiting until your Claude plan's usage falls under where chuggy pauses your work. Setup is done when it finishes. https://chuggy.example/acme/widgets/tickets/1 shows where it is. I'll keep watching it and tell you what changes.",
  );
  expect(kept.at(-1)).toBe(`next: ${program} watch ${at} --usage keep`);
});

test("a first ticket waiting on a live runner with no pause reads no usage and says nothing of it", async () => {
  const site = setupSiteAt("Moving");
  site.projects[0]?.executions.set(1, [setupSiteWaiting(1, "Live")]);
  setupSiteClaude(site, { readings: [reading("five_hour", 0.83)] });
  const machine = await machineSignedIn(site);
  const said = after(await machine.command(flags));
  expect(said[0]).toMatch(/^tell: Ticket 1 is in Work\. Setup is done/u);
  expect(machine.sent.some((sent) => sent.includes("agent-accounts"))).toBe(
    false,
  );
});

test("the threshold offered is the reading rounded up to the next multiple of five, and five more, and never past the whole window", () => {
  expect([80, 81, 83, 85, 90, 91, 94].map(setupUsageOffered)).toEqual([
    85, 90, 90, 90, 95, 100, 100,
  ]);
});

test("every threshold offered is above both the reading and the threshold it replaces", () => {
  for (let percent = 1; percent < 95; percent += 1) {
    const account = setupSiteAccountOf("Claude", {
      settings: {
        fiveHourPercent: percent,
        sevenDayPercent: percent,
        pausesThreads: true,
      },
      readings: [reading("five_hour", percent / 100)],
    });
    const usage = setupUsageOf(account, startMs);
    expect(usage?.usage, String(percent)).toBe("Over");
    if (usage?.usage !== "Over") continue;
    for (const over of usage.over) {
      expect(over.offered).toBeGreaterThan(over.reading);
      expect(over.offered).toBeGreaterThan(over.threshold);
    }
  }
});
