/**
 * The panel's memory of what has been asked at it, walked: random sequences of
 * typing, pressing and answering across two projects, against a reference model
 * of boxes that cannot interfere because they are separate memories.
 *
 * THE PROPERTY IS THAT NOTHING CROSSES. A panel is reconciled rather than
 * replaced when only the route's params move, so one instance holds every
 * project a reader visits — and the faults that shape allows are all "a box
 * observed something that happened to another box": an answer landing on a page
 * it was not asked from, a pair lost to a visit elsewhere, two projects sharing
 * a key. A walk is what refutes them together, no case being able to enumerate
 * the interleavings; the two the panel tier names are two of them.
 *
 * THE RUN IS DETERMINISTIC. Every draw comes from a seeded generator and the
 * seed base is a constant, so on an untouched tree this suite answers the same
 * every time; a finding names the seed, which is the whole reproduction.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  inquiryBoxAnswered,
  inquiryBoxEmpty,
  inquiryBoxName,
  inquiryBoxOf,
  inquiryBoxSent,
  inquiryBoxTyped,
  inquiryBoxWith,
  inquiryDraw,
  inquiryQuestion,
} from "../app/core/leadInquiries.ts";
import type {
  InquiryAsk,
  InquiryBoxes,
  InquiryDraw,
} from "../app/core/leadInquiries.ts";

const walkSeedBase = 20260902;
const walkRuns = 200;
const walkStepsMax = 24;

/** The generator the walk draws from, seeded so a finding reproduces. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = state;
    drawn = Math.imul(drawn ^ (drawn >>> 15), drawn | 1);
    drawn ^= drawn + Math.imul(drawn ^ (drawn >>> 7), drawn | 61);
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two projects whose names a key joining them on any separator either may
 * contain would confuse, so the walk is over the pair such a key shares a box
 * between.
 */
const walkPartitions: readonly [PartitionIdentity, PartitionIdentity] = [
  { tenant: "acme", project: "atlas/beta" },
  { tenant: "acme/atlas", project: "beta" },
];

const walkQuestions = ["why", "why not", "  why  ", ""] as const;

const walkAnswers: readonly InquiryAsk[] = [
  { ask: "Asked", session: "inq-taken" },
  { ask: "Refused", word: "In flight" },
  { ask: "Failed", reason: "the API could not be reached" },
];

type WalkStep =
  | { readonly step: "Typed"; readonly at: 0 | 1; readonly typed: string }
  | { readonly step: "Pressed"; readonly at: 0 | 1 }
  | { readonly step: "Answered"; readonly at: 0 | 1; readonly answer: number };

const walkTypedShare = 0.4;
const walkPressedShare = 0.75;

function walkSteps(draw: () => number): readonly WalkStep[] {
  const count = 1 + Math.floor(draw() * walkStepsMax);
  return Array.from({ length: count }, () => {
    const at = draw() < 0.5 ? 0 : 1;
    const chosen = draw();
    if (chosen < walkTypedShare)
      return {
        step: "Typed" as const,
        at,
        typed:
          walkQuestions[Math.floor(draw() * walkQuestions.length)] ?? "why",
      };
    if (chosen < walkPressedShare) return { step: "Pressed" as const, at };
    return {
      step: "Answered" as const,
      at,
      answer: Math.floor(draw() * walkAnswers.length),
    };
  });
}

/** What the walk records of one send, so a second pair for one question at one
 * door is visible whatever path the reader took to it. */
interface WalkSend {
  readonly at: 0 | 1;
  readonly question: string;
  readonly drawn: string;
  /** Whether this entry is the door taking the pair rather than a send of it. */
  readonly taken: boolean;
}

/** One memory under walk: the boxes, the press outstanding per project, every
 * send in order, and how many pairs each project has drawn. */
interface WalkHeld {
  readonly boxes: InquiryBoxes;
  readonly outstanding: Map<string, InquiryDraw>;
  readonly sends: WalkSend[];
  readonly draws: Map<string, number>;
}

function walkHeldEmpty(): WalkHeld {
  return { boxes: {}, outstanding: new Map(), sends: [], draws: new Map() };
}

/**
 * A pair named for the project that drew it and for how many that project has
 * drawn. That is what lets a reference comparison see a REDRAWN pair: a run
 * whose projects interfere draws one more for a project than that project's own
 * steps would, and the name says so — an opaque draw would differ between any
 * two runs and prove nothing.
 */
function walkMinting(held: WalkHeld, name: string): () => string {
  return () => {
    const drawn = (held.draws.get(name) ?? 0) + 1;
    held.draws.set(name, drawn);
    return `${name}#${String(drawn)}`;
  };
}

/**
 * One step applied to whatever memory it is given, which is the walk's whole
 * subject: over every project's steps it is the panel's memory, and over one
 * project's steps alone it is that project's reference.
 */
function walkStep(held: WalkHeld, step: WalkStep): WalkHeld {
  const partition = walkPartitions[step.at];
  const name = inquiryBoxName(partition);
  const box = inquiryBoxOf(held.boxes, partition);
  if (step.step === "Typed")
    return {
      ...held,
      boxes: inquiryBoxWith(
        held.boxes,
        partition,
        inquiryBoxTyped(box, step.typed),
      ),
    };
  if (step.step === "Pressed") {
    if (held.outstanding.has(name)) return held;
    const question = inquiryQuestion(box.typed);
    const sent = inquiryDraw(
      box.held,
      question,
      partition,
      walkMinting(held, name),
    );
    held.outstanding.set(name, sent);
    held.sends.push({
      at: step.at,
      question,
      drawn: sent.drawn,
      taken: false,
    });
    return {
      ...held,
      boxes: inquiryBoxWith(held.boxes, partition, inquiryBoxSent(box, sent)),
    };
  }
  const outstanding = held.outstanding.get(name);
  const answer = walkAnswers[step.answer];
  if (outstanding === undefined || answer === undefined) return held;
  held.outstanding.delete(name);
  if (answer.ask === "Asked")
    held.sends.push({
      at: step.at,
      question: outstanding.question,
      drawn: outstanding.drawn,
      taken: true,
    });
  return {
    ...held,
    boxes: inquiryBoxWith(
      held.boxes,
      partition,
      inquiryBoxAnswered(box, outstanding, answer),
    ),
  };
}

function walked(steps: readonly WalkStep[], only?: 0 | 1): WalkHeld {
  return (
    only === undefined ? steps : steps.filter((step) => step.at === only)
  ).reduce(walkStep, walkHeldEmpty());
}

/**
 * ONE BOX OBSERVES NOTHING THAT HAPPENED TO ANOTHER. Each project's reference is
 * that project's own steps applied to a memory of its own, so any interference
 * at all is a difference here — an answer written to the wrong box, a pair
 * overwritten by a visit elsewhere, or two projects sharing a key.
 */
test("a walk over two projects leaves each box as its own steps alone would", () => {
  for (let run = 0; run < walkRuns; run += 1) {
    const seed = walkSeedBase + run;
    const steps = walkSteps(seeded(seed));
    const together = walked(steps);
    for (const at of [0, 1] as const) {
      const partition = walkPartitions[at];
      expect(
        inquiryBoxOf(together.boxes, partition),
        `seed ${String(seed)}: one project's box observed another project's steps`,
      ).toStrictEqual(inquiryBoxOf(walked(steps, at).boxes, partition));
    }
  }
});

/**
 * ONE QUESTION AT ONE DOOR IS ONE PAIR UNTIL THAT DOOR TAKES IT. A second pair
 * for the same question is a second fork and the second of the asker's two
 * spent, whether the reader reached it by pressing again or by visiting another
 * project and coming back.
 */
test("a walk never sends two pairs for one project's one question", () => {
  for (let run = 0; run < walkRuns; run += 1) {
    const seed = walkSeedBase + run;
    const sends = walked(walkSteps(seeded(seed))).sends;
    const pairs = new Map<string, string>();
    for (const send of sends) {
      const asked = `${String(send.at)} ${send.question}`;
      if (send.taken) {
        pairs.delete(asked);
        continue;
      }
      const known = pairs.get(asked);
      if (known === undefined) pairs.set(asked, send.drawn);
      else
        expect(
          send.drawn,
          `seed ${String(seed)}: one question at one door was sent under two pairs`,
        ).toBe(known);
    }
  }
});

/** A walk that pressed nothing would assert nothing, so the corpus is checked
 * to have exercised what the two properties are about. */
test("the walk sends, is answered, and returns to a project it has left", () => {
  const sends = Array.from({ length: walkRuns }, (_unused, run) =>
    walked(walkSteps(seeded(walkSeedBase + run))),
  );
  expect(sends.some((held) => held.sends.length > 2)).toBe(true);
  expect(sends.some((held) => held.sends.some((send) => send.taken))).toBe(
    true,
  );
  expect(
    sends.some(
      (held) => Object.keys(held.boxes).length === walkPartitions.length,
    ),
    "no run in the corpus ever held two projects at once",
  ).toBe(true);
});

/** A project nobody has typed at has an empty box rather than none, so nothing
 * has to ask whether a box exists before reading it. */
test("a project with no box reads as an empty one", () => {
  expect(inquiryBoxOf({}, walkPartitions[0])).toBe(inquiryBoxEmpty);
});

/**
 * THE TWO NAMES ARE ENCODED RATHER THAN JOINED. Either may contain whatever a
 * join would separate them by, and two projects sharing a box is the whole of
 * what this keying prevents.
 */
test("two projects a joined key would confuse are filed apart", () => {
  const [first, second] = walkPartitions;
  expect(inquiryBoxName(first)).not.toBe(inquiryBoxName(second));
  const boxes = inquiryBoxWith(
    {},
    first,
    inquiryBoxTyped(inquiryBoxEmpty, "why"),
  );
  expect(inquiryBoxOf(boxes, second)).toBe(inquiryBoxEmpty);
});
