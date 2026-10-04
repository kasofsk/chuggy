/**
 * What a member does next: a turn stopped, and a message sent after it — the
 * same words or other ones. The column is read at every step, by a page open
 * throughout and by one opened at that step, over a mailbox that lists the
 * thread from its first turn and over one that lists only its tail.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadBody } from "./threadFixture.ts";
import {
  stageAlarms,
  stageAnswered,
  stageAsked,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageHeardBlock,
  stageInterrupted,
  stageMounted,
  stageSent,
  stageStopped,
  stageTurn,
  stageWrote,
} from "./threadStopStage.tsx";
import type { Stage, StageEntry } from "./threadStopStage.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const earlier: readonly StageEntry[] = [
  stageAsked("u-a", "is 40 open"),
  stageWrote("u-b", "msg_before", "40 is open."),
];
const opened = ["> is 40 open", "40 is open. (Answered)"];

const asked = "where does 41 stand";
const heard = "It is blocked by 40, and 40 is";
const answer = "41 waits on 40.";

/** What the turn stopped had stored when it was: nothing where it was still
 * waiting or only just taken, its message where no word of an answer had been
 * written, and some of its answer after that. */
const lefts = ["nothing", "its message", "half an answer"] as const;

/** One way the sequence goes: what is sent after the stop, what the turn
 * stopped left in the store, and the ordinal of the oldest turn the mailbox
 * lists. */
interface Resend {
  readonly words: string;
  readonly again: string;
  readonly left: (typeof lefts)[number];
  readonly record: string;
  readonly oldest: number;
}

const resends: readonly Resend[] = [
  { record: "from its first turn", oldest: 1 },
  { record: "only its tail", oldest: 5 },
].flatMap((listed) =>
  [
    { words: "the same words", again: asked },
    { words: "other words", again: "and 42" },
  ].flatMap((sent) => lefts.map((left) => ({ ...listed, ...sent, left }))),
);

const steps = [
  "the turn is stopped",
  "the second is queued",
  "the second is taken",
  "the second's message is stored",
  "the second is answered",
] as const;
type Step = (typeof steps)[number];

type Ended = Parameters<typeof stageTurn>[3];

/** What the second turn is listed as at each step, and nothing before it is
 * sent. */
const secondAt: Record<Step, Ended | undefined> = {
  "the turn is stopped": undefined,
  "the second is queued": "Queued",
  "the second is taken": "Claimed",
  "the second's message is stored": "Claimed",
  "the second is answered": { answer },
};

/** The store's batches at a step: what the stopped turn left, and what the
 * second has come to. */
function storeAt(resend: Resend, step: Step): readonly StageEntry[][] {
  const at = steps.indexOf(step);
  const { left } = resend;
  return [
    [...earlier, ...(left === "nothing" ? [] : [stageAsked("u-c", asked)])],
    [
      ...(left === "half an answer" ? [stageWrote("u-d", "msg_a", heard)] : []),
      ...(left === "nothing" ? [] : [stageInterrupted("u-e")]),
    ],
    ...(at >= 3 ? [[stageAsked("u-f", resend.again)]] : []),
    ...(at >= 4 ? [[stageWrote("u-g", "msg_b", answer)]] : []),
  ];
}

/** The mailbox read at a step, the second turn under the name it was sent. */
function threadAt(resend: Resend, step: Step, second: string): ThreadResponse {
  const { oldest, again } = resend;
  const sent = secondAt[step];
  return threadBody({
    batches: storeAt(resend, step).length,
    turns: [
      stageTurn(oldest, "turn-1", "is 40 open", { answer: "40 is open." }),
      stageTurn(oldest + 1, "turn-2", asked, "Stopped"),
      ...(sent === undefined
        ? []
        : [stageTurn(oldest + 2, second, again, sent)]),
    ],
  });
}

/** The column a member is to be shown at a step: the stopped turn once, with
 * what was stopped of it, and the second under it. */
function columnAt(resend: Resend, step: Step): readonly string[] {
  const stopped =
    resend.left === "half an answer" ? `${heard} (Stopped)` : "(Stopped)";
  const column = [...opened, `> ${asked}`, stopped];
  if (step === "the turn is stopped") return column;
  const under = step === "the second is answered" ? `${answer} (Answered)` : "";
  return [...column, `> ${resend.again}`, under];
}

/** A page opened on the thread while the turn to be stopped is out. */
async function pageOpen(resend: Resend): Promise<Stage> {
  const stage = stageMounted(
    threadBody({
      batches: 1,
      turns: [
        stageTurn(resend.oldest, "turn-1", "is 40 open", {
          answer: "40 is open.",
        }),
        stageTurn(resend.oldest + 1, "turn-2", asked, "Claimed"),
      ],
    }),
    storeAt(resend, "the turn is stopped").slice(0, 1),
  );
  await settled();
  if (resend.left !== "half an answer") return stage;
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "Text",
    text: heard,
  });
  await stageColumnIs(stage.container, [...opened, `> ${asked}`, heard]);
  return stage;
}

/** The store and the mailbox moved to a step, on a page already open. */
async function moved(
  stage: Stage,
  resend: Resend,
  step: Step,
  second: string,
): Promise<void> {
  const store = storeAt(resend, step);
  stage.batches.splice(0, stage.batches.length, ...store);
  stage.draw(threadAt(resend, step, second));
  await settled();
}

describe("a turn stopped and a message sent after it, with the page open throughout", () => {
  test.each(resends)(
    "$words, the stopped turn having stored $left, the mailbox listing $record",
    async (resend) => {
      const stage = await pageOpen(resend);
      await stageStopped();
      const stopped = columnAt(resend, "the turn is stopped");
      expect(stageColumn(stage.container)).toStrictEqual(stopped);
      expect(stageButton()).toBe("Send");

      await stageSent(resend.again);
      const sent = columnAt(resend, "the second is queued");
      expect(stageColumn(stage.container), "at the press").toStrictEqual(sent);
      expect(stageAlarms(stage.container)).toStrictEqual(["engine"]);
      expect(stageButton()).toBe("Stop");

      const [second] = stage.sends;
      const turn = second?.turn ?? "";
      await stageAnswered(stage.stops[0], { stopped: "Stopped" });
      await stageAnswered(second, { turn, ordinal: resend.oldest + 2 }, 202);
      expect(stageColumn(stage.container), "taken").toStrictEqual(sent);

      for (const step of steps.slice(1)) {
        await moved(stage, resend, step, turn);
        await stageColumnIs(stage.container, columnAt(resend, step));
      }
      expect(stageButton()).toBe("Send");
      expect(stageAlarms(stage.container)).toStrictEqual([]);
    },
  );
});

/** Whether a page opened at a step meets the one accepted limit of a turn
 * read without proof its message was stored: the stopped turn's words sit
 * under the second, of the same words, until the second's own are stored. */
function limited(resend: Resend, step: Step): boolean {
  return (
    resend.left === "half an answer" &&
    resend.again === asked &&
    step === "the second is taken"
  );
}

const openings = resends.flatMap((resend) =>
  steps.map((step) => ({ ...resend, step })),
);

/** A page opened on the thread as a step left it. */
async function pageOpenedAt(
  resend: Resend,
  step: Step,
): Promise<readonly string[]> {
  const stage = stageMounted(
    threadAt(resend, step, "turn-3"),
    storeAt(resend, step),
  );
  await settled();
  return stageColumn(stage.container);
}

describe("a turn stopped and a message sent after it, on a page opened part way", () => {
  test.each(openings.filter((at) => !limited(at, at.step)))(
    "$words, the stopped turn having stored $left, listing $record, opened when $step",
    async ({ step, ...resend }) => {
      expect(await pageOpenedAt(resend, step)).toStrictEqual(
        columnAt(resend, step),
      );
    },
  );

  test.each(openings.filter((at) => limited(at, at.step)))(
    "the same words sent after a turn stopped mid-answer, listing $record: a page opened before the second's message is stored draws the stopped words under the second, and rights itself when it is",
    async ({ step, ...resend }) => {
      const stage = stageMounted(
        threadAt(resend, step, "turn-3"),
        storeAt(resend, step),
      );
      await stageColumnIs(stage.container, [
        ...opened,
        `> ${asked}`,
        "(Stopped)",
        `> ${asked}`,
        heard,
      ]);

      const next = "the second's message is stored";
      await moved(stage, resend, next, "turn-3");
      await stageColumnIs(stage.container, columnAt(resend, next));
    },
  );
});
