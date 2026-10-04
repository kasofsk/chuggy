/**
 * What a text would cost the parser, reckoned before the parser sees it.
 *
 * THE PARSER'S COST GROWS FASTER THAN ITS TEXT wherever something in the text
 * makes it look back: a closing mark walks to its opener, a bracket to the
 * bracket it closes, a line that leaves a quote or a nested list copies every
 * event the document has made, a bare address is tried again from each place
 * one could begin. A text built from those costs seconds at a size where prose
 * costs a frame, and the text here is a model's, written after reading pages
 * nobody chose.
 *
 * SO A RUN IS SCANNED ONCE, LEFT TO RIGHT, AND CHARGED FOR EACH LOOK BACK the
 * parser would make, at the distance it would look. A run is the lines between
 * two blank ones, which is as far as any of the parser's words can reach. The
 * charge is an upper reckoning: where the scan cannot tell which of two things
 * the parser will do it charges for the dearer, and it takes a distance to
 * where the words began rather than to the mark that would be found.
 *
 * WHERE THE WORDS BEGAN IS MOVED ONLY WHERE THE GRAMMAR LEAVES NO DOUBT: at the
 * run's first line, at a list line that is one in every position the grammar
 * allows, and at the rows of a table whose header opens the run. Everywhere
 * else the words are taken to go on, which is what makes a table inside a list
 * or a wrapped quote dearer here than it is to the parser.
 *
 * A RUN PAST ITS ALLOWANCE IS DRAWN AS ITS CHARACTERS. The allowance is a floor
 * and a rate for each character, under a ceiling one call may cost, and it is
 * held to at every character rather than at the end. So the verdict on a run is
 * a function of its text alone, a run still being written can go from read to
 * plain and never back, and no text costs much more than its length in ordinary
 * lists would.
 *
 * A LONG LIST IS NOT A RUN PAST ITS ALLOWANCE. Where a run goes past it on a
 * line below one that begins a block at the margin whatever stands above it, a
 * list's line, a quote's or a heading, the run ends at the last such line and
 * the rest is reckoned as a run of its own. So a list longer than one call may
 * cost is read as several, one under another, and only a run with no such line
 * in it is its characters. The line it ends at is above the one that took it
 * past, so every line that decides where is whole and the place never moves.
 *
 * THE WEIGHTS ARE MEASURED, NOT ARGUED. Each is the parser's cost for the worst
 * text of its kind this tree's suites and a seeded search could build, in the
 * units the allowance is written in; `markdownCost.test.ts` holds the parser to
 * the bounds they keep, and `markdownGuard.test.ts` holds each verdict.
 */

/** The most characters and lines one run may hold and still be parsed. */
export const markdownRunCharsMax = 16_384;
export const markdownRunLinesMax = 1_024;

/** The most quote and list marks one line may open with. */
export const markdownLineMarksMax = 16;

/** The longest run of one emphasis mark. */
export const markdownMarkRunMax = 128;

/** What a run or a section may cost: a floor, a rate for each character, and a
 * ceiling over both, in the units `markdownCost` charges in. */
export const markdownWorkFloor = 1_000_000;
export const markdownWorkPerChar = 5_000;
export const markdownWorkMax = 32_000_000;

/** The ceiling for words read as one line, which is read beside a section. */
export const markdownWordsWorkMax = 8_000_000;

/**
 * What each thing the parser does is charged. The ones charged by distance are
 * for each character between the mark and where it makes the parser look.
 */
export const markdownCost = {
  /** One call of the parser, whatever it is handed. */
  call: 40_000,
  char: 330,
  line: 18_000,
  /** A blank line between two runs of one section. */
  blank: 1_800,
  mark: 3_000,
  /** A run of emphasis or strikethrough marks, back to where the words began. */
  attention: 55,
  /** A star that closes one sure to be its opener: back to that opener, and
   * once for what the two of them make. */
  pair: 100,
  paired: 4_000,
  /** A closing bracket, back to where the words began. */
  close: 6,
  /** A word that could begin an address, back to the first open bracket. */
  word: 14,
  /** A line a quote or a list item may be carrying, back over its words. */
  lazy: 22,
  /** A line that may leave a quote or a list, over the document so far. */
  exit: 20,
  /** A bare address that may fail, for each character it would read first. */
  forward: 110,
  /** A character that may end an address, over the ones before it that may. */
  trail: 40,
  /** A place an email could begin, for each character after it in its word,
   * and the `@` that may make one of it. */
  email: 1,
  mail: 6_000,
  /** An address written where the grammar takes none, for each character
   * after it in its word. */
  refused: 2,
  /** A bare address that begins, and a backslash that escapes. */
  link: 4_500,
  escape: 2_400,
  /** A place in the words where an address is tried for. */
  tried: 300,
  /** A link whose title may never close, for each character after it. */
  title: 16,
  /** A run of code marks that may never close, for each character after. */
  tick: 40,
  /** A pipe, which in a table's row ends a cell. */
  cell: 6_000,
} as const;

/** What one run came to. */
export interface MarkdownRun {
  /** Where it ends: the line that ended it, or the end of the text. */
  readonly end: number;
  /** What ended it: a blank line, a fence opened at the margin, the text, or
   * its allowance, at a line above that begins a block of its own. */
  readonly stop: "blank" | "fence" | "end" | "cut";
  /** What the parser is reckoned to spend on it alone. */
  readonly work: number;
  /** How many of its lines may leave a quote or a list. */
  readonly exits: number;
  /** Whether it is past its allowance, and drawn as its characters. */
  readonly plain: boolean;
  /** Whether it is past what the section it would join may still spend. */
  readonly apart: boolean;
  /** Whether nothing above it can reach into it: its first line begins at the
   * margin with something other than a list mark. */
  readonly fresh: boolean;
}

const space = 1;
const alphanumeric = 2;
const mailText = 4;
const trail = 8;
const punctuation = 16;

/** What each ASCII character is to the scan. */
const kinds = ((): Uint8Array => {
  const table = new Uint8Array(128);
  for (const code of [9, 10, 32]) table[code] = space;
  for (let code = 33; code < 127; code += 1) {
    const letter = (code > 64 && code < 91) || (code > 96 && code < 123);
    table[code] =
      letter || (code > 47 && code < 58)
        ? alphanumeric | mailText
        : punctuation;
  }
  const also = (marks: string, kind: number): void => {
    for (const mark of marks) {
      const code = mark.charCodeAt(0);
      table[code] = (table[code] ?? 0) | kind;
    }
  };
  also("+-._", mailText);
  also("!\"')*,.:;?_~]&", trail);
  return table;
})();

function kindOf(code: number): number {
  return code < 128 ? (kinds[code] ?? 0) : 0;
}

const sideSpacePattern = /\s/u;
const sidePunctuationPattern = /[\p{P}\p{S}]/u;

/** What a character is to a mark beside it, by the grammar's own sorting:
 * space, punctuation, or neither. */
function sideOf(code: number): 0 | 1 | 2 {
  if (code < 128) {
    if (code === 32 || (code > 8 && code < 14)) return 1;
    return (kindOf(code) & punctuation) === 0 ? 0 : 2;
  }
  const character = String.fromCharCode(code);
  if (sideSpacePattern.test(character)) return 1;
  return sidePunctuationPattern.test(character) ? 2 : 0;
}

/** A run of code marks nothing has closed yet, and what the scan held when it
 * met it, which is what it holds again if a later run closes it. */
interface Tick {
  readonly at: number;
  readonly depth: number;
  readonly bracket: number;
  readonly pending: number;
}

interface Scan {
  readonly text: string;
  readonly from: number;
  /** What the section this run would join has spent, and its length. */
  readonly carriedWork: number;
  readonly carriedChars: number;
  /** The most the allowance comes to, however long the text. */
  readonly ceiling: number;
  work: number;
  exits: number;
  lines: number;
  plain: boolean;
  apart: boolean;
  /** The content columns of the list items known to be open, and the mark
   * each was opened with. */
  readonly cols: number[];
  readonly marks: number[];
  /** The mark of the outermost item the last line closed. */
  left: number;
  /** Whether a quote or a list this scan does not follow may be open. */
  loose: boolean;
  /** Whether no quote or list can be open: every line so far began one of
   * neither. */
  top: boolean;
  /** Whether every line so far is one quote's own. */
  quoted: boolean;
  /** The cells of a header that opened the run, and whether a rule under it
   * made a table of it. */
  header: number;
  table: boolean;
  /** Where the words being read began. */
  content: number;
  previous: number;
  /** Whether a backslash has made the next character its own, and where the
   * run of marks being read ends. */
  escaped: boolean;
  skip: number;
  /** The brackets no closing one has met: how many, and where the first is. */
  depth: number;
  bracket: number;
  /** The runs of code marks still open by their length, how many the words
   * are charged for, and whether they can no longer be followed. */
  readonly ticks: Map<number, Tick>;
  pending: number;
  ticked: boolean;
  /** The stars opened and sure to be the grammar's own: where, and how wide. */
  readonly opens: number[];
  readonly widths: number[];
  /** A link's address being read: none, its address, the space after it, or
   * a title nothing may close; how deep its brackets are; how many are read. */
  resource: 0 | 1 | 2 | 3;
  parens: number;
  titles: number;
  /** Whether an address between angle brackets may be being read. */
  angle: boolean;
  /** In the word being read: the addresses that may have begun, the
   * characters that may end one, and the places an email could begin. */
  links: number;
  trail: number;
  entity: boolean;
  starts: number;
  /** The addresses written in the word that the grammar does not take. */
  refused: number;
  /** Whether the line being read begins a block at the margin whatever
   * stands above it. */
  sure: boolean;
}

function markdownScanFrom(
  text: string,
  from: number,
  carriedWork: number,
  carriedChars: number,
  ceiling: number,
): Scan {
  return {
    text,
    from,
    carriedWork,
    carriedChars,
    ceiling,
    work: 0,
    exits: 0,
    lines: 0,
    plain: false,
    apart: false,
    cols: [],
    marks: [],
    left: 0,
    loose: true,
    top: false,
    quoted: false,
    header: 0,
    table: false,
    content: from,
    previous: 10,
    escaped: false,
    skip: 0,
    depth: 0,
    bracket: -1,
    ticks: new Map(),
    pending: 0,
    ticked: false,
    opens: [],
    widths: [],
    resource: 0,
    parens: 0,
    titles: 0,
    angle: false,
    links: 0,
    trail: 0,
    entity: false,
    starts: 0,
    refused: 0,
    sure: false,
  };
}

function markdownAllowance(scan: Scan, chars: number): number {
  return Math.min(
    scan.ceiling,
    markdownWorkFloor + markdownWorkPerChar * chars,
  );
}

/** The scan held to its allowance at one character, alone and as part of the
 * section it would join. */
function markdownScanChecked(scan: Scan, at: number): void {
  const chars = at - scan.from + 1;
  if (scan.work > markdownAllowance(scan, chars) || chars > markdownRunCharsMax)
    scan.plain = true;
  const joined =
    scan.carriedWork +
    scan.work +
    scan.exits * markdownCost.exit * scan.carriedChars;
  if (joined > markdownAllowance(scan, scan.carriedChars + chars))
    scan.apart = true;
}

/** The words begin again here: nothing before this place is theirs. */
function markdownScanContent(scan: Scan, at: number): void {
  scan.content = at;
  scan.escaped = false;
  scan.skip = 0;
  scan.depth = 0;
  scan.bracket = -1;
  scan.ticks.clear();
  scan.pending = 0;
  scan.ticked = false;
  scan.opens.length = 0;
  scan.widths.length = 0;
  scan.resource = 0;
  scan.parens = 0;
  scan.titles = 0;
  scan.angle = false;
  scan.links = 0;
  scan.trail = 0;
  scan.entity = false;
  scan.starts = 0;
  scan.refused = 0;
}

/** Code marks still open can no longer be followed: what closes one depends
 * on where the grammar ends the words, which the scan does not know. */
function markdownScanTicked(scan: Scan): void {
  if (scan.ticks.size === 0) return;
  scan.ticked = true;
  scan.ticks.clear();
}

/** A word ends, and with it any address that had begun in it. */
function markdownScanWordEnd(scan: Scan): void {
  scan.links = 0;
  scan.trail = 0;
  scan.entity = false;
  scan.starts = 0;
  scan.refused = 0;
  scan.angle = false;
  if (scan.resource === 1) scan.resource = 2;
}

/** A line that may leave a quote or a list, which copies the document. */
function markdownScanExit(scan: Scan, at: number): void {
  scan.exits += 1;
  scan.work += (at - scan.from) * markdownCost.exit;
}

/** A line the scan cannot place: it may be carried by a paragraph above it or
 * may close what is open, so it is charged for both. */
function markdownScanDoubt(scan: Scan, at: number): void {
  scan.work += (at - scan.content) * markdownCost.lazy;
  markdownScanExit(scan, at);
  scan.loose = true;
  scan.top = false;
  scan.quoted = false;
  scan.table = false;
}

function letter(code: number): boolean {
  const lower = code | 32;
  return code < 128 && lower > 96 && lower < 123;
}

/** Whether an address is written from a letter on: `www.`, `http://` or
 * `https://`, in any case and whatever stands before it. */
function markdownScanAddressed(
  text: string,
  at: number,
  code: number,
): boolean {
  if ((code | 32) === 119)
    return (
      (text.charCodeAt(at + 1) | 32) === 119 &&
      (text.charCodeAt(at + 2) | 32) === 119 &&
      text.charCodeAt(at + 3) === 46
    );
  const head = text.slice(at, at + 8).toLowerCase();
  return head.startsWith("http://") || head === "https://";
}

/** Whether the grammar takes an address written from a letter on, by what
 * stands before it: `www.` after a space or one of a few marks, the others
 * after anything but a letter. */
function markdownScanLinked(previous: number, code: number): boolean {
  if ((code | 32) !== 119) return !letter(previous);
  return (
    (kindOf(previous) & space) !== 0 ||
    previous === 40 ||
    previous === 42 ||
    previous === 95 ||
    previous === 91 ||
    previous === 93 ||
    previous === 126
  );
}

/**
 * A character an email's name may hold: one after a character that is not one
 * may begin an email, and so may a `w` or an `h` where a bare address could
 * begin, and each is tried, with a bracket open by walking back to it to
 * refuse. An address the grammar does not take is looked for again once the
 * text is read, from each place one is written to the end of its word.
 */
function markdownScanNamed(scan: Scan, at: number, code: number): void {
  const before = kindOf(scan.previous);
  if ((before & alphanumeric) === 0) scan.starts += 1;
  scan.work += scan.starts * markdownCost.email;
  const lower = code | 32;
  const tried =
    ((before & mailText) === 0 && scan.previous !== 47) ||
    (lower === 119 && scan.previous === 95) ||
    (lower === 104 && !letter(scan.previous));
  if (tried) scan.work += markdownCost.tried;
  if (tried && scan.depth > 0)
    scan.work += (at - scan.bracket) * markdownCost.word;
  if (lower !== 119 && lower !== 104) return;
  if (!markdownScanAddressed(scan.text, at, code)) return;
  if (!markdownScanLinked(scan.previous, code)) {
    scan.refused += 1;
    return;
  }
  scan.links += 1;
  scan.work += markdownCost.link;
}

/** A character that may end a bare address, charged over the ones before it
 * that may: the parser reads on through them to see whether the address
 * goes on. */
function markdownScanTrail(scan: Scan, code: number, kind: number): void {
  const trailing =
    scan.links > 0 &&
    ((kind & trail) !== 0 || (scan.entity && (kind & alphanumeric) !== 0));
  if (!trailing) {
    scan.trail = 0;
    scan.entity = false;
    return;
  }
  scan.trail += 1;
  scan.work += scan.trail * markdownCost.trail;
  if ((kind & alphanumeric) === 0) scan.entity = code === 38;
}

/** Whether a mark here may be something else's own characters: an address's,
 * a title's, or a bare address's. */
function markdownScanDoubted(scan: Scan): boolean {
  return scan.resource !== 0 || scan.angle || scan.links > 0;
}

/** Whether a run of marks could open and could close, by the grammar's rule
 * about what stands on either side of it. */
function markdownScanFlanks(
  scan: Scan,
  code: number,
  end: number,
  to: number,
): { readonly opens: boolean; readonly closes: boolean } {
  const next = end < to ? scan.text.charCodeAt(end) : 10;
  const before = sideOf(scan.previous);
  const after = sideOf(next);
  const marks = (side: number): boolean =>
    code !== 126 && (side === 42 || side === 95 || side === 126);
  const opens = after === 0 || (after === 2 && before !== 0) || marks(next);
  const closes =
    before === 0 || (before === 2 && after !== 0) || marks(scan.previous);
  if (code !== 95) return { opens, closes };
  return {
    opens: opens && (before !== 0 || !closes),
    closes: closes && (after !== 0 || !opens),
  };
}

/**
 * A run of emphasis or strikethrough marks: one that can close walks back for
 * its opener, to the star that opened it where that is sure to be the
 * grammar's own and otherwise to where the words began. One the text ends in
 * may still grow, and is charged once it has.
 */
function markdownScanAttention(
  scan: Scan,
  at: number,
  code: number,
  to: number,
): void {
  let end = at + 1;
  while (end < to && scan.text.charCodeAt(end) === code) end += 1;
  scan.skip = end;
  const run = end - at;
  if (run > markdownMarkRunMax) scan.plain = true;
  if (end === scan.text.length || (code === 126 && run !== 2)) return;
  scan.work += markdownCost.mark;
  const { opens, closes } = markdownScanFlanks(scan, code, end, to);
  const sure = code === 42 && !markdownScanDoubted(scan);
  if (!closes) {
    if (opens && sure) {
      scan.opens.push(at);
      scan.widths.push(run);
    }
    return;
  }
  const paired = sure && !opens && scan.widths.at(-1) === run;
  const opener = paired ? (scan.opens.at(-1) ?? at) : scan.content;
  const weight = paired ? markdownCost.pair : markdownCost.attention;
  scan.work += (at - opener + 1) * ((run + 1) >> 1) * weight;
  if (paired) scan.work += markdownCost.paired;
  scan.opens.length = paired ? scan.opens.length - 1 : 0;
  scan.widths.length = scan.opens.length;
}

/**
 * A run of code marks, of which one the text ends in may still grow. The
 * grammar closes the first run with the next of its length and reads
 * everything between as code, so a run that closes one puts the scan back to
 * what it held there, and after one that closes none the words are read on
 * to their end.
 */
function markdownScanTicks(scan: Scan, at: number, to: number): void {
  let end = at + 1;
  while (end < to && scan.text.charCodeAt(end) === 96) end += 1;
  scan.skip = end;
  if (end === scan.text.length) return;
  scan.work += markdownCost.mark;
  scan.opens.length = 0;
  scan.widths.length = 0;
  const run = end - at;
  const opened = scan.ticks.get(run);
  if (markdownScanDoubted(scan)) markdownScanTicked(scan);
  if (scan.ticked || opened === undefined) {
    scan.pending += 1;
    if (!scan.ticked)
      scan.ticks.set(run, {
        at,
        depth: scan.depth,
        bracket: scan.bracket,
        pending: scan.pending - 1,
      });
    return;
  }
  for (const [width, tick] of scan.ticks)
    if (tick.at >= opened.at) scan.ticks.delete(width);
  scan.depth = opened.depth;
  scan.bracket = opened.bracket;
  scan.pending = opened.pending;
}

/** A closing bracket, which walks back for the bracket it closes and, where
 * it is sure to be the grammar's own, closes the last one open. */
function markdownScanClosed(scan: Scan, at: number): void {
  scan.work += (at - scan.content + 1) * markdownCost.close + markdownCost.mark;
  scan.opens.length = 0;
  scan.widths.length = 0;
  const sure =
    scan.ticks.size === 0 && !scan.ticked && !markdownScanDoubted(scan);
  if (sure && scan.depth > 0) scan.depth -= 1;
  if (scan.depth === 0) scan.bracket = -1;
  if (scan.text.charCodeAt(at + 1) !== 40) return;
  scan.titles += 1;
  const angled = scan.text.charCodeAt(at + 2) === 60;
  scan.resource = scan.resource === 0 && !angled ? 1 : 3;
  scan.parens = -1;
}

/** The first character after the space that follows a link's address, which
 * says whether the address is over or a title has begun. */
function markdownScanTitled(scan: Scan, code: number): void {
  if (code === 34 || code === 39 || code === 40) scan.resource = 3;
  else {
    scan.resource = 0;
    scan.titles -= 1;
  }
}

function markdownScanMark(
  scan: Scan,
  at: number,
  code: number,
  to: number,
): void {
  if (code === 42 || code === 95 || code === 126)
    markdownScanAttention(scan, at, code, to);
  else if (code === 96) markdownScanTicks(scan, at, to);
  else if (code === 93) markdownScanClosed(scan, at);
  else if (code === 91) {
    scan.depth += 1;
    if (scan.depth === 1) scan.bracket = at;
    scan.work += markdownCost.mark;
  } else if (code === 40 && scan.resource === 1) scan.parens += 1;
  else if (code === 41 && scan.resource === 1) {
    scan.parens -= 1;
    if (scan.parens >= 0) return;
    scan.resource = 0;
    scan.titles -= 1;
  } else if (code === 60) {
    scan.links = 0;
    scan.angle = true;
    scan.work += markdownCost.mark;
  } else if (code === 62) scan.angle = false;
  else if (code === 124) {
    markdownScanTicked(scan);
    scan.work += markdownCost.cell;
  } else if (code === 38) scan.work += markdownCost.mark;
}

/** One character of the words taken into the scan. A backslash before a code
 * mark escapes it only outside code, so code marks open there are in doubt. */
function markdownScanChar(
  scan: Scan,
  at: number,
  code: number,
  to: number,
): void {
  const kind = kindOf(code);
  if ((kind & space) !== 0) {
    markdownScanWordEnd(scan);
    return;
  }
  if (scan.resource === 2) markdownScanTitled(scan, code);
  if ((kind & mailText) !== 0) markdownScanNamed(scan, at, code);
  else {
    if (code === 64 && scan.starts > 0) scan.work += markdownCost.mail;
    scan.starts = 0;
  }
  markdownScanTrail(scan, code, kind);
  if ((kind & punctuation) === 0) return;
  const escaped = scan.escaped;
  const next = scan.text.charCodeAt(at + 1);
  const escapes = (kindOf(next) & punctuation) !== 0;
  scan.escaped = code === 92 && !escaped && at + 1 < to && escapes;
  if (scan.escaped) scan.work += markdownCost.escape;
  if (scan.escaped && next === 96) markdownScanTicked(scan);
  if (!escaped && at >= scan.skip) markdownScanMark(scan, at, code, to);
}

/** The words between two places on one line, each character charged. */
function markdownScanWords(scan: Scan, from: number, to: number): void {
  const text = scan.text;
  for (let at = from; at < to && !scan.plain; at += 1) {
    const code = text.charCodeAt(at);
    scan.work +=
      markdownCost.char +
      scan.links * markdownCost.forward +
      scan.refused * markdownCost.refused +
      scan.pending * markdownCost.tick +
      scan.titles * markdownCost.title;
    markdownScanChar(scan, at, code, to);
    scan.previous = code;
    markdownScanChecked(scan, at);
  }
}

const linePlain = 0;
const lineBlank = 1;
const linePending = 2;
const lineFence = 3;
const lineQuote = 4;
const lineItem = 5;

/** How one line opens. */
interface Line {
  readonly kind: number;
  /** The spaces before its first character, and whether a tab is among what
   * it is indented or spaced with. */
  readonly indent: number;
  readonly tabbed: boolean;
  /** Where its first character is, and where its words begin after a mark. */
  readonly at: number;
  readonly words: number;
  /** A list mark: the bullet's own character or an ordered one's delimiter,
   * and whether an ordered one is the number that may begin a list anywhere. */
  readonly mark: number;
  readonly one: boolean;
  /** How many quote and list marks the line opens with. */
  readonly marks: number;
}

function digit(code: number): boolean {
  return code > 47 && code < 58;
}

/** Whether a character is a space or a tab, which is all this reader ever
 * means by blank. */
export function markdownBlankCode(code: number): boolean {
  return code === 32 || code === 9;
}

const markNone = -1;
const markPending = -2;

/**
 * Where the quote or list mark at a place ends, `markNone` where none is
 * there, and `markPending` where the text ends before that can be told.
 */
function markdownMarkEnd(text: string, at: number, end: number): number {
  const code = text.charCodeAt(at);
  if (code === 62) return at + 1;
  let after = at + 1;
  if (digit(code)) {
    while (after < end && after - at < 9 && digit(text.charCodeAt(after)))
      after += 1;
    if (after === end) return end === text.length ? markPending : markNone;
    const delimiter = text.charCodeAt(after);
    if (delimiter !== 46 && delimiter !== 41) return markNone;
    after += 1;
  } else if (code !== 45 && code !== 43 && code !== 42) return markNone;
  if (after === end) return end === text.length ? markPending : after;
  return markdownBlankCode(text.charCodeAt(after)) ? after : markNone;
}

/** How many quote and list marks follow one another from a place. */
function markdownMarksFrom(text: string, from: number, end: number): number {
  let marks = 0;
  let at = from;
  while (marks <= markdownLineMarksMax && at < end) {
    const after = markdownMarkEnd(text, at, end);
    if (after < 0) break;
    marks += 1;
    at = after;
    while (at < end && markdownBlankCode(text.charCodeAt(at))) at += 1;
  }
  return marks;
}

/**
 * Whether a line at the margin opens a fence: three or more backticks with
 * none after them, or three or more tildes. A line the text ends in that could
 * yet become one answers too, and its having no end tells the two apart.
 */
function markdownFenceOpens(text: string, at: number, end: number): boolean {
  const code = text.charCodeAt(at);
  if (code !== 96 && code !== 126) return false;
  let after = at + 1;
  while (after < end && text.charCodeAt(after) === code) after += 1;
  if (after - at < 3) return after === end && end === text.length;
  return code === 126 || !text.slice(after, end).includes("`");
}

function markdownLineRead(text: string, start: number, end: number): Line {
  let at = start;
  while (at < end && text.charCodeAt(at) === 32) at += 1;
  const indent = at - start;
  let tabbed = false;
  while (at < end && markdownBlankCode(text.charCodeAt(at))) {
    tabbed = true;
    at += 1;
  }
  const line = { indent, tabbed, at, words: at, mark: 0, one: false, marks: 0 };
  if (at === end) return { ...line, kind: lineBlank };
  if (indent === 0 && !tabbed && markdownFenceOpens(text, at, end))
    return { ...line, kind: lineFence };
  const after = markdownMarkEnd(text, at, end);
  if (after === markPending) return { ...line, kind: linePending };
  if (after === markNone) return { ...line, kind: linePlain };
  const code = text.charCodeAt(at);
  let words = after;
  while (words < end && markdownBlankCode(text.charCodeAt(words))) {
    if (text.charCodeAt(words) === 9 || words - after > 3) tabbed = true;
    words += 1;
  }
  if (code !== 62 && words === end && end === text.length)
    return { ...line, kind: linePending };
  return {
    indent,
    tabbed,
    at,
    words,
    kind: code === 62 ? lineQuote : lineItem,
    mark: digit(code) ? text.charCodeAt(after - 1) : code,
    one: digit(code) && after - at === 2 && code === 49,
    marks: 1 + markdownMarksFrom(text, words, end),
  };
}

/**
 * How many cells the grammar counts in a header that opens with a pipe, or
 * none where it holds too little to be one. An escaped pipe is its cell's own.
 */
function markdownHeaderCells(text: string, start: number, end: number): number {
  let cells = 0;
  let parts = 0;
  let divided = false;
  let at = start;
  while (at < end) {
    const code = text.charCodeAt(at);
    at += 1;
    if (markdownBlankCode(code)) continue;
    parts += 1;
    if (divided) cells += 1;
    divided = code === 124;
    if (divided) continue;
    at -= 1;
    while (at < end) {
      const held = text.charCodeAt(at);
      if (held === 124 || markdownBlankCode(held)) break;
      at += 1;
      const next = text.charCodeAt(at);
      if (held === 92 && at < end && (next === 92 || next === 124)) at += 1;
    }
  }
  return parts > 1 ? cells : 0;
}

/** How many cells the rule under a header has where it too opens with a pipe,
 * or none where the line is no rule. */
function markdownRuleCells(text: string, start: number, end: number): number {
  let cells = 0;
  let at = start;
  while (at < end) {
    if (text.charCodeAt(at) !== 124) return 0;
    at += 1;
    while (at < end && markdownBlankCode(text.charCodeAt(at))) at += 1;
    if (at === end) break;
    if (text.charCodeAt(at) === 58) at += 1;
    const dashes = at;
    while (at < end && text.charCodeAt(at) === 45) at += 1;
    if (at === dashes) return 0;
    cells += 1;
    if (at < end && text.charCodeAt(at) === 58) at += 1;
    while (at < end && markdownBlankCode(text.charCodeAt(at))) at += 1;
  }
  return cells;
}

/** The items a line is not indented under are closed. How many there were,
 * with the mark of the outermost of them left in `scan.left`. */
function markdownScanPopped(scan: Scan, indent: number): number {
  let popped = 0;
  while (scan.cols.length > 0 && (scan.cols.at(-1) ?? 0) > indent) {
    scan.cols.pop();
    scan.left = scan.marks.pop() ?? 0;
    popped += 1;
  }
  return popped;
}

/**
 * A line that opens with a list mark, taken as the item it is where the
 * grammar leaves no doubt: its words begin again, and it copies the document
 * only where a list nested under its own was open. Whether it was one.
 */
function markdownScanItem(
  scan: Scan,
  line: Line,
  start: number,
  end: number,
  popped: number,
): boolean {
  const bullet = line.mark !== 46 && line.mark !== 41;
  const sibling = popped > 0 && scan.left === line.mark && !scan.loose;
  if (line.words === end) return false;
  if (!bullet && !line.one && !sibling && scan.lines > 1) return false;
  if (popped > 1 || scan.loose) markdownScanExit(scan, start);
  scan.loose = line.indent > 0 && scan.loose;
  scan.top = false;
  scan.quoted = false;
  scan.table = false;
  if (line.marks > 1 || line.tabbed) scan.loose = true;
  else {
    scan.cols.push(line.words - start);
    scan.marks.push(line.mark);
  }
  markdownScanContent(scan, line.words);
  scan.sure = line.at === start;
  return true;
}

/** Whether a whole line at the margin is a heading: one to six hashes and
 * then a blank or the line's end. */
function markdownHeadingOpens(text: string, at: number, end: number): boolean {
  let after = at;
  while (after < end && text.charCodeAt(after) === 35) after += 1;
  const hashes = after - at;
  if (hashes === 0 || hashes > 6) return false;
  return after === end || markdownBlankCode(text.charCodeAt(after));
}

/** A line that opens with neither mark: it leaves what it is not indented
 * under, is a row of the table the run opened with, or goes on with the words
 * above it. */
function markdownScanPlain(
  scan: Scan,
  line: Line,
  start: number,
  end: number,
  popped: number,
): void {
  const margin = line.indent === 0 && !line.tabbed;
  const piped = margin && scan.text.charCodeAt(start) === 124;
  if (scan.lines === 1) {
    markdownScanExit(scan, start);
    scan.loose = !margin;
    scan.top = margin;
    if (piped) scan.header = markdownHeaderCells(scan.text, start, end);
    return;
  }
  if (!scan.top && (popped > 0 || scan.loose || scan.quoted))
    markdownScanDoubt(scan, start);
  const whole = end < scan.text.length;
  if (scan.lines === 2 && scan.header > 0 && piped && whole)
    scan.table = markdownRuleCells(scan.text, start, end) === scan.header;
  else if (scan.table && piped) markdownScanContent(scan, start);
  else scan.table = false;
}

/** One line taken as the block it opens, and where its words begin. */
function markdownScanLine(
  scan: Scan,
  line: Line,
  start: number,
  end: number,
): number {
  if (line.marks > markdownLineMarksMax) scan.plain = true;
  const popped = markdownScanPopped(scan, line.indent);
  const near = line.indent - (scan.cols.at(-1) ?? 0) < 4;
  if (line.kind === lineItem && near) {
    if (markdownScanItem(scan, line, start, end, popped)) return line.words;
    markdownScanDoubt(scan, start);
    return line.at;
  }
  if (line.kind !== lineQuote) {
    markdownScanPlain(scan, line, start, end, popped);
    scan.sure =
      line.at === start && markdownHeadingOpens(scan.text, start, end);
    return line.at;
  }
  const own =
    line.indent === 0 &&
    !line.tabbed &&
    line.marks === 1 &&
    (scan.lines === 1 || scan.quoted);
  if (own) {
    scan.loose = false;
    scan.top = false;
    scan.quoted = true;
  } else markdownScanDoubt(scan, start);
  scan.sure = line.at === start;
  return line.at;
}

/** A line begins: it is counted and charged, and nothing a line cannot hold
 * across its end is carried into it. Whether the scan goes on. */
function markdownScanLineBegun(scan: Scan): boolean {
  scan.lines += 1;
  if (scan.lines > markdownRunLinesMax) scan.plain = true;
  if (scan.plain) return false;
  scan.work += markdownCost.line;
  markdownScanWordEnd(scan);
  markdownScanTicked(scan);
  scan.escaped = false;
  scan.previous = 10;
  return true;
}

/** One line of a run charged: what it opens, then its words. */
function markdownScanTaken(
  scan: Scan,
  line: Line,
  start: number,
  end: number,
): void {
  scan.sure = false;
  if (markdownScanLineBegun(scan))
    markdownScanWords(scan, markdownScanLine(scan, line, start, end), end);
}

function markdownRunOf(
  scan: Scan,
  end: number,
  stop: MarkdownRun["stop"],
  fresh: boolean,
): MarkdownRun {
  return {
    end,
    stop,
    work: scan.work,
    exits: scan.exits,
    plain: scan.plain,
    apart: scan.apart || scan.plain,
    fresh,
  };
}

/** A place a run may be ended at, and what the scan held when it reached
 * it. */
interface Cut {
  readonly at: number;
  readonly work: number;
  readonly exits: number;
  readonly apart: boolean;
}

function markdownRunCut(cut: Cut, fresh: boolean): MarkdownRun {
  return {
    end: cut.at,
    stop: "cut",
    work: cut.work,
    exits: cut.exits,
    plain: false,
    apart: cut.apart,
    fresh,
  };
}

/**
 * The run that begins at the start of a line, scanned to the line that ends
 * it. `carriedWork` and `carriedChars` are what the section it would join has
 * spent and how long that is, which decide `apart` and nothing else.
 */
export function markdownRunScanned(
  text: string,
  from: number,
  carriedWork = 0,
  carriedChars = 0,
): MarkdownRun {
  const scan = markdownScanFrom(
    text,
    from,
    carriedWork,
    carriedChars,
    markdownWorkMax,
  );
  let fresh = false;
  let cut: Cut | undefined;
  let at = from;
  while (at < text.length) {
    const newline = text.indexOf("\n", at);
    const end = newline < 0 ? text.length : newline;
    const line = markdownLineRead(text, at, end);
    const ends = line.kind === lineBlank || line.kind === lineFence;
    if (ends && newline >= 0) {
      if (line.kind === lineFence)
        return markdownRunOf(scan, at, "fence", fresh);
      if (!scan.top && (scan.quoted || scan.loose)) {
        markdownScanExit(scan, at);
        markdownScanChecked(scan, at - 1);
      }
      return markdownRunOf(scan, at, "blank", fresh);
    }
    if (ends || line.kind === linePending) {
      scan.work += (end - at) * markdownCost.char;
      break;
    }
    if (scan.lines === 0)
      fresh = line.indent === 0 && !line.tabbed && line.kind !== lineItem;
    const { work, exits, apart } = scan;
    markdownScanTaken(scan, line, at, end);
    if (scan.plain && cut !== undefined) return markdownRunCut(cut, fresh);
    if (scan.sure && at > from) cut = { at, work, exits, apart };
    at = newline < 0 ? end : end + 1;
  }
  return markdownRunOf(scan, text.length, "end", fresh);
}

/** Whether a text read as words alone, no block read in it, is within what
 * that may cost: each line is charged as a line and its words as words. */
export function markdownWordsPass(text: string): boolean {
  const scan = markdownScanFrom(text, 0, 0, 0, markdownWordsWorkMax);
  let at = 0;
  while (at < text.length && markdownScanLineBegun(scan)) {
    const newline = text.indexOf("\n", at);
    const end = newline < 0 ? text.length : newline;
    markdownScanWords(scan, at, end);
    markdownScanChecked(scan, end - 1);
    at = end + 1;
  }
  return !scan.plain;
}
