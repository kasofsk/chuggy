/**
 * One page of a raw transcript, cut into an answer a tool can hand the model.
 *
 * A STORE BATCH IS NOT AN ANSWER. The transcript routes page by store batch,
 * and a batch is bounded by the store's own line bound — which is what one
 * whole answer has to fit inside, envelope and copies included. So the smallest
 * page the route serves is still larger than the largest answer, and a tool
 * that only relayed it would have nothing smaller to offer a caller who asked
 * for less. This cuts below that granularity instead: whole entries while they
 * fit, and a cursor naming where the next answer resumes.
 *
 * THE CURSOR IS THE TWO ARGUMENTS THE CALLER PASSES BACK. `after` is the
 * route's own batch cursor and `entry` is how many of that page's entries this
 * answer has already given, so resuming asks the route the same question and
 * skips what was read. Every answer either gives an entry, moves `after` on, or
 * names no next at all, which is what makes a walk terminate.
 *
 * AN ENTRY LARGER THAN AN ANSWER IS PREVIEWED, NEVER REFUSED. A stored tool
 * result can be most of a line on its own, and a refusal there would stop a
 * walk on an entry the caller cannot make smaller. Its kind, its weight and the
 * head of it go instead, under `preview`, and the cursor moves past it.
 *
 * THE PAGE'S OWN `held` IS DROPPED. It is decided over the whole stream and
 * weighs with the page rather than with the entries answered, so a slice of a
 * page cannot state it; everything else the route said about the page is
 * carried through.
 */

import { Buffer } from "node:buffer";

/** How much of an entry too large to answer whole is shown in its place. */
export const transcriptEntryPreviewCharsMax = 1_024;

/** What this answer states for itself: the entries it gives, the cursor, and the held set it cannot. */
const transcriptPageAnswerReplaces = ["entries", "nextAfter", "held"];

/** One entry nothing can answer whole: what it is, what it weighs, and its head. */
function transcriptEntryPreview(entry) {
  const whole = JSON.stringify(entry);
  return {
    ...(typeof entry?.uuid === "string" ? { uuid: entry.uuid } : {}),
    ...(typeof entry?.type === "string" ? { type: entry.type } : {}),
    bytes: Buffer.byteLength(whole),
    preview: whole.slice(0, transcriptEntryPreviewCharsMax),
  };
}

/**
 * The answer for one route page, given where the caller resumed and what fits.
 * `fits` is the tool's own bound rather than this module's, because what an
 * answer may weigh is a property of the transcript it is stored in.
 */
export function transcriptPageAnswer(page, cursor, fits) {
  const { entries = [], nextAfter } = page ?? {};
  const rest = Object.fromEntries(
    Object.entries(page ?? {}).filter(
      ([field]) => !transcriptPageAnswerReplaces.includes(field),
    ),
  );
  const after = cursor?.after ?? 0;
  const from = cursor?.entry ?? 0;
  const composed = (given, next) =>
    JSON.stringify({
      ...rest,
      entries: given,
      ...(next === undefined ? {} : { next }),
    });

  let given = [];
  let stop;
  for (let index = from; index < entries.length; index += 1) {
    const candidate = [...given, entries[index]];
    if (fits(composed(candidate, { after, entry: index + 1 }))) {
      given = candidate;
      continue;
    }
    if (given.length === 0) {
      given = [transcriptEntryPreview(entries[index])];
      stop = index + 1;
    } else stop = index;
    break;
  }

  const beyond =
    nextAfter === undefined || nextAfter === null
      ? undefined
      : { after: nextAfter, entry: 0 };
  let next = stop === undefined ? beyond : { after, entry: stop };
  let text = composed(given, next);
  // The cursor is composed after the entries were weighed without it, so a page
  // filled to the byte can be over by the cursor's own width. Giving one entry
  // back is what makes the bound hold rather than nearly hold.
  while (!fits(text) && given.length > 1) {
    given = given.slice(0, -1);
    next = { after, entry: from + given.length };
    text = composed(given, next);
  }
  return text;
}
