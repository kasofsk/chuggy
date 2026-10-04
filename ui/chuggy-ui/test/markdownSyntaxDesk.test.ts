/**
 * The desk that has code read off the page's thread: what it asks a worker
 * and when, what it does with an answer, and what it does with a worker that
 * does not give one.
 *
 * The worker is `markdownSyntaxDouble.ts`'s, which says only what a case has
 * it say, and the time is a number the case moves with the runner's timers,
 * so every wait here is counted and none is slept through.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  markdownSyntaxDeadlineMs,
  markdownSyntaxDesk,
  markdownSyntaxRest,
} from "../app/browser/ui/markdownSyntax.ts";
import type {
  MarkdownSyntaxDesk,
  MarkdownSyntaxReading,
  MarkdownSyntaxSeat,
} from "../app/browser/ui/markdownSyntax.ts";
import { syntaxDoubleHeld } from "./markdownSyntaxDouble.ts";
import type {
  SyntaxDouble,
  SyntaxDoubleWorker,
} from "./markdownSyntaxDouble.ts";

let now = 0;

/** Time passes: the clock the desk reads and the timers it set, together. */
function pass(ms: number): void {
  now += ms;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  now = 1_000;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Sat {
  readonly seat: MarkdownSyntaxSeat;
  readonly told: MarkdownSyntaxReading[];
}

function sat(desk: MarkdownSyntaxDesk): Sat {
  const told: MarkdownSyntaxReading[] = [];
  return { told, seat: desk.seat((reading) => told.push(reading)) };
}

function desked(): { readonly double: SyntaxDouble; desk: MarkdownSyntaxDesk } {
  const double = syntaxDoubleHeld();
  return { double, desk: markdownSyntaxDesk(double.open, () => now) };
}

function codes(worker: SyntaxDoubleWorker | undefined): readonly string[] {
  return (worker?.asked ?? []).map((asked) => asked.code);
}

/** A worker answers the last thing it was asked with runs of a case's own. */
function answer(worker: SyntaxDoubleWorker | undefined, runs: unknown): void {
  worker?.say({ id: worker.asked.at(-1)?.id, runs });
}

describe("a block asked about", () => {
  test("starts one worker, and is told the runs of the text that was read", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    expect(double.workers).toHaveLength(0);
    block.seat.ask("const a = 1;", "typescript");
    const [worker] = double.workers;
    expect(worker?.asked).toEqual([
      { id: 1, code: "const a = 1;", language: "typescript" },
    ]);
    worker?.say({ ready: true });
    answer(worker, [{ scope: "hljs-keyword", children: ["const"] }, " a = 1;"]);
    expect(block.told).toEqual([
      {
        code: "const a = 1;",
        language: "typescript",
        runs: [{ scope: "hljs-keyword", children: ["const"] }, " a = 1;"],
      },
    ]);
    expect(double.workers).toHaveLength(1);
  });

  test("is asked about only as it last stood, however often it moved while a reading was out", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("a", "typescript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    block.seat.ask("ab", "typescript");
    block.seat.ask("abc", "typescript");
    expect(codes(worker)).toEqual(["a"]);
    answer(worker, ["a"]);
    expect(block.told.map((reading) => reading.code)).toEqual(["a"]);
    expect(codes(worker)).toEqual(["a", "abc"]);
  });
});

describe("what a worker says that is no answer to the block out", () => {
  test("is not told where it is not runs", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    const said: readonly unknown[] = [
      undefined,
      "const",
      [{ scope: "hljs-keyword" }],
      [{ scope: 4, children: [] }],
      [{ scope: "hljs-keyword", children: [4] }],
      [null],
    ];
    for (const runs of said) {
      block.seat.ask(`a${String(said.indexOf(runs))}`, "typescript");
      double.workers[0]?.say({ ready: true });
      answer(double.workers[0], runs);
    }
    expect(codes(double.workers[0])).toHaveLength(said.length);
    expect(block.told).toEqual([]);
  });

  test("is not told an answer to a question that is not the one out", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("a", "typescript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    worker?.say({ id: 7, runs: ["a"] });
    worker?.say("a");
    worker?.say(null);
    expect(block.told).toEqual([]);
    answer(worker, ["a"]);
    expect(block.told).toHaveLength(1);
  });

  test("is not told to a block that has left, which is not asked about again", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("a", "typescript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    block.seat.ask("ab", "typescript");
    block.seat.leave();
    answer(worker, ["a"]);
    block.seat.ask("abc", "typescript");
    expect(block.told).toEqual([]);
    expect(codes(worker)).toEqual(["a"]);
  });
});

describe("blocks waiting on one worker", () => {
  test("are read one at a time", () => {
    const { double, desk } = desked();
    const [first, second] = [sat(desk), sat(desk)];
    first.seat.ask("one", "typescript");
    second.seat.ask("two", "javascript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    expect(codes(worker)).toEqual(["one"]);
    answer(worker, ["one"]);
    expect(codes(worker)).toEqual(["one", "two"]);
    answer(worker, ["two"]);
    expect(first.told).toHaveLength(1);
    expect(second.told).toHaveLength(1);
    expect(double.workers).toHaveLength(1);
  });

  test("take turns, the one read longest ago first", () => {
    const { double, desk } = desked();
    const seats = [sat(desk), sat(desk), sat(desk)];
    const round = (turn: number): void => {
      seats.forEach((held, at) => {
        held.seat.ask(`${String(at)}.${String(turn)}`, "typescript");
      });
    };
    round(0);
    const [worker] = double.workers;
    worker?.say({ ready: true });
    for (let turn = 1; turn < 4; turn += 1) {
      round(turn);
      answer(worker, []);
    }
    expect(codes(worker)).toEqual(["0.0", "1.1", "2.2", "0.3"]);
  });

  test("rest after a reading for a multiple of the time it was out, and hold no other block back by it", () => {
    expect(markdownSyntaxRest).toBe(3);
    const { double, desk } = desked();
    const [slow, other] = [sat(desk), sat(desk)];
    slow.seat.ask("a", "typescript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    pass(40);
    slow.seat.ask("ab", "typescript");
    answer(worker, ["a"]);
    expect(codes(worker)).toEqual(["a"]);
    other.seat.ask("b", "typescript");
    expect(codes(worker)).toEqual(["a", "b"]);
    answer(worker, ["b"]);
    pass(119);
    expect(codes(worker)).toEqual(["a", "b"]);
    pass(1);
    expect(codes(worker)).toEqual(["a", "b", "ab"]);
  });
});

describe("a reading that does not come back", () => {
  test("ends its worker at the deadline, counted from when the worker was ready", () => {
    expect(markdownSyntaxDeadlineMs).toBe(3_000);
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("[a](".repeat(5_000), "markdown");
    const [worker] = double.workers;
    pass(60_000);
    expect(worker?.ended).toBe(false);
    worker?.say({ ready: true });
    pass(2_999);
    expect(worker?.ended).toBe(false);
    pass(1);
    expect(worker?.ended).toBe(true);
    expect(block.told).toEqual([]);
  });

  test("leaves its block unread for as long as it is drawn, and the next block is read by a new worker", () => {
    const { double, desk } = desked();
    const [hostile, next] = [sat(desk), sat(desk)];
    hostile.seat.ask("<script>".repeat(2_500), "xml");
    next.seat.ask("const a = 1;", "typescript");
    double.workers[0]?.say({ ready: true });
    pass(3_000);
    expect(double.workers).toHaveLength(2);
    expect(codes(double.workers[1])).toEqual(["const a = 1;"]);
    double.workers[1]?.say({ ready: true });
    answer(double.workers[1], ["const a = 1;"]);
    expect(next.told).toHaveLength(1);
    hostile.seat.ask("<a>", "xml");
    pass(60_000);
    expect(codes(double.workers[1])).toEqual(["const a = 1;"]);
    expect(double.workers).toHaveLength(2);
    expect(hostile.told).toEqual([]);
  });

  test("is not listened to once its worker has been ended", () => {
    const { double, desk } = desked();
    const [hostile, next] = [sat(desk), sat(desk)];
    hostile.seat.ask("slow", "xml");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    pass(3_000);
    next.seat.ask("b", "typescript");
    worker?.say({ id: 1, runs: ["slow"] });
    worker?.say({ id: 2, runs: ["b"] });
    expect(hostile.told).toEqual([]);
    expect(next.told).toEqual([]);
  });

  test("is not ended by a deadline once it has answered", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("a", "typescript");
    const [worker] = double.workers;
    worker?.say({ ready: true });
    pass(2_000);
    answer(worker, ["a"]);
    pass(60_000);
    expect(worker?.ended).toBe(false);
    block.seat.ask("ab", "typescript");
    expect(codes(worker)).toEqual(["a", "ab"]);
  });
});

describe("a worker that breaks, or cannot be started", () => {
  test("is ended where it says it failed, its block left unread and the next read by a new one", () => {
    const { double, desk } = desked();
    const [broken, next] = [sat(desk), sat(desk)];
    broken.seat.ask("a", "typescript");
    next.seat.ask("b", "typescript");
    double.workers[0]?.say({ failed: true });
    expect(double.workers[0]?.ended).toBe(true);
    expect(codes(double.workers[1])).toEqual(["b"]);
    broken.seat.ask("ab", "typescript");
    double.workers[1]?.say({ ready: true });
    answer(double.workers[1], ["b"]);
    expect(codes(double.workers[1])).toEqual(["b"]);
    expect(broken.told).toEqual([]);
  });

  test("leaves a block as it is where none can be started, and throws nothing", () => {
    const desk = markdownSyntaxDesk(
      () => {
        throw new Error("no worker is to be had");
      },
      () => now,
    );
    const block = sat(desk);
    expect(() => {
      block.seat.ask("a", "typescript");
      block.seat.ask("ab", "typescript");
    }).not.toThrow();
    expect(block.told).toEqual([]);
  });

  test("is ended with the desk, and a block asking afterwards starts a new one", () => {
    const { double, desk } = desked();
    const block = sat(desk);
    block.seat.ask("a", "typescript");
    double.workers[0]?.say({ ready: true });
    desk.end();
    expect(double.workers[0]?.ended).toBe(true);
    pass(60_000);
    block.seat.ask("ab", "typescript");
    expect(double.workers).toHaveLength(2);
    expect(codes(double.workers[1])).toEqual(["ab"]);
  });
});
