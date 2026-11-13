/**
 * The reader's own agent accounts, derived: a pause in words and whether a
 * press is offered, whether a reading still counts, a reading's share, and a
 * draft of one agent's settings held to the bounds the wire takes.
 */

import { expect, test } from "vitest";
import { copyTextEn } from "../app/copy/catalog.ts";

import type { AgentAccount } from "../../../src/contract/responses.ts";
import { agentPauseReasons } from "../../../src/contract/rosters.ts";
import {
  agentAccountCredentialsDrawn,
  agentAccountDraftOf,
  agentAccountDraftRead,
  agentAccountDraftSame,
  agentAccountPercentFault,
  agentAccountPressRefusal,
  agentAccountReading,
  agentAccountReadingStale,
  agentPauseParts,
  agentPausePressable,
  agentPauseReasonLabel,
} from "../app/core/agentAccounts.ts";
import { shareFigure } from "../app/core/figures.ts";

const settings = {
  fiveHourPercent: 80,
  sevenDayPercent: 90,
  pausesThreads: true,
};

const claude: AgentAccount = {
  agent: "Claude",
  settings,
  readings: [
    {
      window: "five_hour",
      utilization: 0.42,
      resetsAt: "2026-10-03T14:00:00Z",
      observedAt: "2026-10-03T09:00:00Z",
    },
  ],
};

test("every reason a pause gives is a noun, and a pause reads as its status and each reason", () => {
  expect(
    agentPauseReasons.map((reason) =>
      copyTextEn(agentPauseReasonLabel(reason)),
    ),
  ).toStrictEqual(["Five-hour window", "Weekly window", "Provider limit"]);
  expect(
    agentPauseParts({
      until: "2026-10-03T14:00:00Z",
      reasons: ["seven_day", "limit"],
      pressed: false,
    }).map(copyTextEn),
  ).toStrictEqual(["Paused", "Weekly window", "Provider limit"]);
});

test("a press is offered only where a provider's limit holds the agent and no press is waiting to try it", () => {
  const until = "2026-10-03T14:00:00Z";
  expect(
    agentPausePressable({ until, reasons: ["limit"], pressed: false }),
  ).toBe(true);
  expect(
    agentPausePressable({ until, reasons: ["limit"], pressed: true }),
  ).toBe(false);
  expect(
    agentPausePressable({ until, reasons: ["five_hour"], pressed: false }),
  ).toBe(false);
  expect(agentPausePressable(undefined)).toBe(false);
});

/** The pause rule counts a reading only while its reset is ahead. */
test("a reading is stale once its window has reset, and a window never read has no reading", () => {
  const reading = agentAccountReading(claude, "five_hour");
  if (reading === undefined) throw new Error("the fixture reads five_hour");
  const resetsAtMs = Date.parse(reading.resetsAt);
  expect(agentAccountReadingStale(reading, resetsAtMs - 1)).toBe(false);
  expect(agentAccountReadingStale(reading, resetsAtMs)).toBe(true);
  expect(
    agentAccountReadingStale({ ...reading, resetsAt: "never" }, resetsAtMs),
  ).toBe(true);
  expect(agentAccountReading(claude, "seven_day")).toBeUndefined();
});

test("an agent holding one credential or none, or read without the field, is drawn by its own; one holding several by each current one, in the wire's order", () => {
  const nowMs = Date.parse("2026-10-03T10:00:00Z");
  const fresh = claude.readings;
  const stale: AgentAccount["readings"] = [
    {
      window: "seven_day",
      utilization: 0.95,
      resetsAt: "2026-10-03T09:00:00Z",
      observedAt: "2026-09-26T00:00:00Z",
    },
  ];
  const pause = {
    until: "2026-10-03T14:00:00Z",
    reasons: ["limit" as const],
    pressed: false,
  };
  expect(agentAccountCredentialsDrawn(claude, nowMs)).toBeUndefined();
  expect(
    agentAccountCredentialsDrawn({ ...claude, credentials: [] }, nowMs),
  ).toBeUndefined();
  expect(
    agentAccountCredentialsDrawn(
      { ...claude, credentials: [{ name: "home", readings: fresh }] },
      nowMs,
    ),
  ).toBeUndefined();
  const held = (
    credentials: NonNullable<AgentAccount["credentials"]>,
  ): readonly string[] | undefined =>
    agentAccountCredentialsDrawn({ ...claude, credentials }, nowMs)?.map(
      (credential) => credential.name,
    );
  expect(
    held([
      { name: "home", readings: fresh },
      { name: "old", readings: stale },
      { name: "spare", readings: [], pause },
      { name: "work", readings: stale, pause },
    ]),
  ).toStrictEqual(["home", "spare", "work"]);
  expect(
    held([
      { name: "old", readings: stale },
      { name: "unread", readings: [] },
    ]),
  ).toStrictEqual([]);
});

test("a share is read in whole percent, rounded down past the float's noise", () => {
  expect(shareFigure(0.29)).toStrictEqual({
    kind: "Quantity",
    text: "29",
    unit: { id: "figures-unit-percent" },
  });
  expect(shareFigure(0.799)).toMatchObject({ text: "79" });
  expect(shareFigure(1)).toMatchObject({ text: "100" });
});

test("a draft is the settings as typed, and reads back to them", () => {
  const draft = agentAccountDraftOf(settings);
  expect(draft).toStrictEqual({
    ...settings,
    fiveHourPercent: "80",
    sevenDayPercent: "90",
  });
  expect(agentAccountDraftRead(draft)).toStrictEqual({
    settings,
    faults: undefined,
  });
  expect(agentAccountDraftSame(draft, settings)).toBe(true);
  expect(
    agentAccountDraftSame({ ...draft, pausesThreads: false }, settings),
  ).toBe(false);
});

test.each(["0", "101", "", "8.5", "-3", "eighty"])(
  "a threshold typed as %j is refused in its own box, and nothing is written",
  (typed) => {
    const read = agentAccountDraftRead({
      ...agentAccountDraftOf(settings),
      sevenDayPercent: typed,
    });
    expect(read.settings).toBeUndefined();
    expect([...(read.faults ?? [])]).toStrictEqual(["sevenDayPercent"]);
  },
);

test("both ends of the bound are taken, and the refusal names them", () => {
  const read = agentAccountDraftRead({
    ...agentAccountDraftOf(settings),
    fiveHourPercent: "1",
    sevenDayPercent: " 100 ",
  });
  expect(read.settings).toMatchObject({
    fiveHourPercent: 1,
    sevenDayPercent: 100,
  });
  expect(copyTextEn(agentAccountPercentFault)).toBe("Whole percent, 1 to 100");
});

test("a press refused because no limit holds the agent says so, and any other refusal is its word", () => {
  expect(
    copyTextEn(
      agentAccountPressRefusal({
        outcome: "Conflict",
        code: "NotHardPaused",
        body: undefined,
      }),
    ),
  ).toBe("No limit holds it");
  expect(copyTextEn(agentAccountPressRefusal({ outcome: "Absent" }))).toBe(
    "Not found",
  );
});
