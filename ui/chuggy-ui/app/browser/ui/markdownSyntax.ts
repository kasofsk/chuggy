/**
 * The colouring of a block of code: which languages are coloured, what a
 * coloured block is, and the desk that has each block read off the page's
 * thread.
 *
 * NO GRAMMAR RUNS WHERE A READER IS WAITING. A grammar is patterns nobody here
 * wrote, and some take seconds over a text a model can be led to write. So a
 * block is drawn as its characters at once, a worker is asked for its runs,
 * and it is coloured when they come back. Colour is all that arrives: a
 * coloured run is the same characters in the same face, so nothing drawn
 * changes its place.
 *
 * A LANGUAGE IS COLOURED ONLY WHERE THE FENCE NAMES IT. Nothing guesses at
 * what an unnamed block is written in, because a wrong guess colours prose as
 * code, and a name outside the table below is drawn plain.
 *
 * ONE READING IS OUT AT A TIME, AND A BLOCK IS ASKED ABOUT AS IT STANDS. A
 * block that grows while a reading is out is asked about once more, as it is
 * by then, and after an answer it rests for a multiple of the time that answer
 * took, so a long block being written is coloured in steps. The blocks take
 * turns.
 *
 * A READING THAT DOES NOT COME BACK ENDS ITS WORKER. Past
 * `markdownSyntaxDeadlineMs` the worker is ended, the block it was reading
 * stays its characters for as long as it is drawn, and the next block is read
 * by a new one. The time is counted from when the worker said it was ready,
 * so a slow fetch of the grammars is not a slow reading.
 *
 * A WORKER THAT DOES NOT START IS THE LAST ONE ASKED FOR. One that cannot be
 * started, that breaks before it says it is ready, or that has not said so
 * `markdownSyntaxReadyMs` after it was started, is not a slow reading: nothing
 * about the next block would start it. So the desk closes, every block stays
 * its characters, and a page of many blocks has started one worker and not
 * one for each.
 */

import type { MarkdownClock } from "./markdownReading.ts";
import type {
  MarkdownSyntaxAsked,
  MarkdownSyntaxNode,
} from "./markdownSyntaxRead.ts";

export type { MarkdownSyntaxAsked, MarkdownSyntaxNode };

/** How long a reading may be out before its worker is ended, in
 * milliseconds. */
export const markdownSyntaxDeadlineMs = 3_000;

/** How long a worker may take to say it is ready before the desk closes, in
 * milliseconds: the fetch of its module on a slow line, and nothing slower. */
export const markdownSyntaxReadyMs = 30_000;

/** How many times the time its last reading was out a block rests for before
 * it is read again. */
export const markdownSyntaxRest = 3;

/** A worker as the desk holds one: asked, and ended. */
export interface MarkdownSyntaxWorker {
  readonly ask: (asked: MarkdownSyntaxAsked) => void;
  readonly end: () => void;
}

/** Starts a worker. `heard` is told each thing it says, never before this
 * returns: that it is ready, an answer, or `{ failed: true }` where it broke. */
export type MarkdownSyntaxOpen = (
  heard: (message: unknown) => void,
) => MarkdownSyntaxWorker;

/** The runs one text of a block was read as. */
export interface MarkdownSyntaxReading {
  readonly code: string;
  readonly language: string;
  readonly runs: readonly MarkdownSyntaxNode[];
}

/** One block's place at the desk. */
export interface MarkdownSyntaxSeat {
  /** Asks about the block as it now stands, in place of any text of it not
   * yet sent. */
  readonly ask: (code: string, language: string) => void;
  readonly leave: () => void;
}

/** What has every block of a page read, one at a time. */
export interface MarkdownSyntaxDesk {
  /** A place for one block, whose readings `told` is handed. */
  readonly seat: (
    told: (reading: MarkdownSyntaxReading) => void,
  ) => MarkdownSyntaxSeat;
  /** Ends the worker and forgets what was out; a block asking afterwards
   * starts a new one, unless the desk has closed. */
  readonly end: () => void;
}

/** The grammar each name a fence gives a language is read with. */
export const markdownSyntaxLanguages: Readonly<Record<string, string>> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",
  css: "css",
  diff: "diff",
  patch: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  go: "go",
  golang: "go",
  ini: "ini",
  toml: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  kotlin: "kotlin",
  kt: "kotlin",
  md: "markdown",
  markdown: "markdown",
  php: "php",
  py: "python",
  python: "python",
  python3: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  html: "xml",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/** The grammar a fence's word names, whatever case it was written in. */
export function markdownSyntaxLanguage(named: string): string | undefined {
  const name = named.toLowerCase();
  return Object.hasOwn(markdownSyntaxLanguages, name)
    ? markdownSyntaxLanguages[name]
    : undefined;
}

interface Wanted {
  readonly code: string;
  readonly language: string;
}

interface Seat {
  readonly told: (reading: MarkdownSyntaxReading) => void;
  /** The text it is to be asked about next. */
  wanted: Wanted | undefined;
  /** Whether a reading of it ended a worker, after which it is not read. */
  refused: boolean;
  seated: boolean;
  /** The time before which it is not read again. */
  until: number;
}

interface Out extends Wanted {
  readonly seat: Seat;
  readonly id: number;
  readonly at: number;
}

type Timer = ReturnType<typeof setTimeout>;

interface Desk {
  readonly open: MarkdownSyntaxOpen;
  readonly clock: MarkdownClock;
  /** Every block with a place, the one read longest ago first. */
  readonly seats: Set<Seat>;
  worker: MarkdownSyntaxWorker | undefined;
  /** Which worker this is, counted, so one already ended is not listened to. */
  born: number;
  ready: boolean;
  /** Whether a worker failed to start, after which none is started. */
  closed: boolean;
  out: Out | undefined;
  asked: number;
  deadline: Timer | undefined;
  wake: Timer | undefined;
}

/** What one node from the worker holds, where it is a scope or the runs
 * themselves, or nothing where it is neither. */
function markdownSyntaxHeld(node: object): readonly unknown[] | undefined {
  if (Array.isArray(node)) return node as readonly unknown[];
  const { scope, children } = node as {
    readonly scope?: unknown;
    readonly children?: unknown;
  };
  if (typeof scope !== "string" || !Array.isArray(children)) return undefined;
  return children as readonly unknown[];
}

/** A value from the worker as the runs it claims to be, or nothing where it is
 * not runs: only strings and scopes holding the same. */
function markdownSyntaxRuns(
  value: unknown,
): readonly MarkdownSyntaxNode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node === "string") continue;
    if (typeof node !== "object" || node === null) return undefined;
    const held = markdownSyntaxHeld(node);
    if (held === undefined) return undefined;
    for (const child of held) pending.push(child);
  }
  return value as readonly MarkdownSyntaxNode[];
}

function markdownSyntaxDeadlineSet(desk: Desk): void {
  clearTimeout(desk.deadline);
  desk.deadline = setTimeout(() => {
    markdownSyntaxGivenUp(desk, true);
    markdownSyntaxPumped(desk);
  }, markdownSyntaxDeadlineMs);
}

/** The worker is ended, and where it was reading a block that block is not
 * read again. */
function markdownSyntaxGivenUp(desk: Desk, refused: boolean): void {
  clearTimeout(desk.deadline);
  desk.deadline = undefined;
  desk.worker?.end();
  desk.worker = undefined;
  desk.ready = false;
  const out = desk.out;
  desk.out = undefined;
  if (out !== undefined && refused) {
    out.seat.refused = true;
    out.seat.wanted = undefined;
  }
}

/** The desk closes: its worker is ended, and no other is started. */
function markdownSyntaxClosed(desk: Desk): void {
  desk.closed = true;
  markdownSyntaxGivenUp(desk, true);
}

function markdownSyntaxAnswered(desk: Desk, out: Out, runs: unknown): void {
  clearTimeout(desk.deadline);
  desk.deadline = undefined;
  desk.out = undefined;
  const now = desk.clock();
  out.seat.until = now + (now - out.at) * markdownSyntaxRest;
  const read = markdownSyntaxRuns(runs);
  if (read !== undefined && out.seat.seated)
    out.seat.told({ code: out.code, language: out.language, runs: read });
}

function markdownSyntaxHeard(desk: Desk, message: unknown): void {
  if (typeof message !== "object" || message === null) return;
  const { ready, failed, id, runs } = message as {
    readonly ready?: unknown;
    readonly failed?: unknown;
    readonly id?: unknown;
    readonly runs?: unknown;
  };
  if (ready === true) {
    desk.ready = true;
    if (desk.out === undefined) return;
    desk.out = { ...desk.out, at: desk.clock() };
    markdownSyntaxDeadlineSet(desk);
    return;
  }
  if (failed === true && !desk.ready) markdownSyntaxClosed(desk);
  else if (failed === true) markdownSyntaxGivenUp(desk, true);
  else if (desk.out !== undefined && id === desk.out.id)
    markdownSyntaxAnswered(desk, desk.out, runs);
  else return;
  markdownSyntaxPumped(desk);
}

/** The desk's worker, started where there is none and given its time to say
 * it is ready, or nothing where one cannot be started. */
function markdownSyntaxWorking(desk: Desk): MarkdownSyntaxWorker | undefined {
  if (desk.worker !== undefined || desk.closed) return desk.worker;
  desk.born += 1;
  const born = desk.born;
  try {
    desk.worker = desk.open((message) => {
      if (desk.born === born && desk.worker !== undefined)
        markdownSyntaxHeard(desk, message);
    });
    desk.deadline = setTimeout(() => {
      markdownSyntaxClosed(desk);
    }, markdownSyntaxReadyMs);
  } catch {
    markdownSyntaxClosed(desk);
  }
  return desk.worker;
}

/** One block sent to be read. It goes to the back of the turns, and where no
 * worker can be had it is not read again. */
function markdownSyntaxSent(desk: Desk, seat: Seat, wanted: Wanted): void {
  desk.seats.delete(seat);
  desk.seats.add(seat);
  seat.wanted = undefined;
  const worker = markdownSyntaxWorking(desk);
  if (worker === undefined) {
    seat.refused = true;
    return;
  }
  desk.asked += 1;
  desk.out = { seat, id: desk.asked, at: desk.clock(), ...wanted };
  worker.ask({ id: desk.asked, ...wanted });
  if (desk.ready) markdownSyntaxDeadlineSet(desk);
}

/** The next block that wants reading and is rested is sent, or the desk is
 * woken when the first of them will be. */
function markdownSyntaxPumped(desk: Desk): void {
  clearTimeout(desk.wake);
  desk.wake = undefined;
  if (desk.out !== undefined) return;
  const now = desk.clock();
  let soonest = Infinity;
  for (const seat of desk.seats) {
    if (seat.wanted === undefined) continue;
    if (seat.until <= now) {
      markdownSyntaxSent(desk, seat, seat.wanted);
      return;
    }
    soonest = Math.min(soonest, seat.until);
  }
  if (soonest === Infinity) return;
  desk.wake = setTimeout(() => {
    markdownSyntaxPumped(desk);
  }, soonest - now);
}

function markdownSyntaxSeated(
  desk: Desk,
  told: (reading: MarkdownSyntaxReading) => void,
): MarkdownSyntaxSeat {
  const seat: Seat = {
    told,
    wanted: undefined,
    refused: false,
    seated: true,
    until: 0,
  };
  desk.seats.add(seat);
  return {
    ask: (code, language) => {
      if (seat.refused || !seat.seated) return;
      seat.wanted = { code, language };
      markdownSyntaxPumped(desk);
    },
    leave: () => {
      seat.seated = false;
      seat.wanted = undefined;
      desk.seats.delete(seat);
    },
  };
}

/** A desk over the workers `open` starts, telling the time by `clock`. */
export function markdownSyntaxDesk(
  open: MarkdownSyntaxOpen,
  clock: MarkdownClock,
): MarkdownSyntaxDesk {
  const desk: Desk = {
    open,
    clock,
    seats: new Set(),
    worker: undefined,
    born: 0,
    ready: false,
    closed: false,
    out: undefined,
    asked: 0,
    deadline: undefined,
    wake: undefined,
  };
  return {
    seat: (told) => markdownSyntaxSeated(desk, told),
    end: () => {
      clearTimeout(desk.wake);
      desk.wake = undefined;
      markdownSyntaxGivenUp(desk, false);
    },
  };
}
