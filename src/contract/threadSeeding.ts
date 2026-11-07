/**
 * The headings a thread's first turn is written under, the ones a later turn
 * naming a page or an image opens with instead and the lines under each, the
 * boundary over the member's own message, and the standing rules a project
 * runs its threads by until it sets its own.
 *
 * IT IS THE CONTRACT BECAUSE EVERY SIDE READS IT. The interpreter writes the
 * boundary between the block and the message, the console splits on it, and the
 * durable read cuts a title after it, so each draws the member's own words
 * rather than a document they never typed. A copy of it on any reading side
 * would be a split that goes wrong the day the writing side is reworded,
 * silently, on every thread's first turn.
 */

import { consolePageSchema } from "./consolePage.ts";
import type { ConsolePage } from "./consolePage.ts";
import type { ChuggyTool } from "./sessionTools.ts";

/**
 * The standing rules a thread is bound by where its project has set none:
 * which channel its commands go through, and what a wake is. A project tool is
 * a command its owner already has; the lead's decisions are the lead's.
 */
export const threadStandingRulesDefault = `- You act through the same commands your owner has in the console, recorded as their act; the lead's decisions are the lead's, and you neither make nor amend one.
- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.`;

/**
 * The standing rules one project's threads run under: its own where it set
 * them, the default otherwise. It is the whole of the precedence, so a
 * system prompt, a seeding block and a wake document cannot read it three ways.
 */
export function resolvedThreadStandingRules(override?: string): string {
  return override ?? threadStandingRulesDefault;
}

export const threadNorthStarHeading = "# North Star";
export const threadDraftsHeading = "# Your open drafts";
export const threadRefusalsHeading = "# Standing against them";
export const threadStandingHeading = "# How you act on this project";

/**
 * The heading a first turn's own message is written under, and so the boundary
 * a reader splits the member's words off after. It is fixed where the standing
 * rules above it are not.
 */
export const threadTurnBoundaryHeading = "# What your owner says";

/**
 * The heading a turn sent from a console page names that page under, whether
 * or not it is the first: naming one is not seeding, so it carries no project
 * text and sheds nothing, but it sits in front of the same boundary a first
 * turn's block does, and in front of the images section where there is one.
 */
export const threadPageHeading = "# Current displayed page";

/** What separates a field's name from its value on one line under
 * `threadPageHeading`, which no field name contains. */
const threadPageFieldSeparator = ": ";

/** The fields a page section writes as numbers, and so reads back as them. */
const threadPageNumberFields: ReadonlySet<string> = new Set([
  "ticket",
  "from",
  "draft",
  "epic",
]);

/** What a page names beyond which page it is, field by field in the order a
 * turn writes them, with a field it leaves out as undefined. */
function threadPageFields(
  page: ConsolePage,
): readonly (readonly [string, string | number | undefined])[] {
  switch (page.page) {
    case "Tickets":
    case "Inbox":
    case "Lead":
    case "Catalog":
    case "Repositories":
    case "Runners":
    case "Epics":
      return [];
    case "Epic":
      return [["epic", page.epic]];
    case "Ticket":
    case "TicketEdit":
      return [["ticket", page.ticket]];
    case "TicketNew":
      return "draft" in page ? [["draft", page.draft]] : [["from", page.from]];
    case "Repository":
      return [["repository", page.repository]];
    case "Settings":
      return [["section", page.section]];
  }
}

/** The page section a turn sent from a console page carries: the page, then
 * each thing on it the page names, a line each. */
export function threadPageSection(page: ConsolePage): string {
  const lines = [
    ["page", page.page] as const,
    ...threadPageFields(page),
  ].flatMap(([field, value]) =>
    value === undefined
      ? []
      : [`- ${field}${threadPageFieldSeparator}${String(value)}`],
  );
  return `${threadPageHeading}\n\n${lines.join("\n")}`;
}

/**
 * A block with its page section read off: what stands before it, and the page
 * it names. The section is the last thing a block holds once its images are
 * read off, so a block with none, or with one naming a page the vocabulary
 * does not, is answered whole and naming none.
 */
export function threadPageRead(block: string): {
  readonly before: string;
  readonly page?: ConsolePage;
} {
  const heading = `${threadPageHeading}\n\n`;
  const opens = block.startsWith(heading)
    ? 0
    : block.lastIndexOf(`\n\n${heading}`);
  if (opens < 0) return { before: block };
  const lines = block
    .slice(block.indexOf(heading, opens) + heading.length)
    .split("\n");
  const fields = lines.flatMap((line) => {
    const at = line.indexOf(threadPageFieldSeparator);
    if (!line.startsWith("- ") || at <= 2) return [];
    const field = line.slice(2, at);
    const value = line.slice(at + threadPageFieldSeparator.length);
    return [
      [
        field,
        threadPageNumberFields.has(field) && /^[0-9]+$/u.test(value)
          ? Number(value)
          : value,
      ] as const,
    ];
  });
  const page =
    fields.length === lines.length
      ? consolePageSchema.safeParse(Object.fromEntries(fields)).data
      : undefined;
  return page === undefined
    ? { before: block }
    : { before: block.slice(0, opens), page };
}

/**
 * The heading a turn that names an image puts its images under, whether or not
 * it is the first: naming one is not seeding, so it carries no project text and
 * sheds nothing, but it sits in front of the same boundary a first turn's block
 * does, which is what lets a reader who has never heard of images still split
 * one off correctly.
 */
export const threadImagesHeading = "# Images with this message";

/** What separates the fields of one line under `threadImagesHeading`, which
 * no artifact identity or media type contains. */
const threadImageFieldSeparator = " — ";

/** The tool a session reads a named image with. */
const threadImageTool: ChuggyTool = "fetch_image";

/** One line under `threadImagesHeading`: the image's identity, its media type,
 * and the tool a session reads it with. */
export function threadImageLine(image: {
  readonly artifact: string;
  readonly mediaType: string;
}): string {
  return `- ${[image.artifact, image.mediaType, `read it with ${threadImageTool}`].join(threadImageFieldSeparator)}`;
}

/**
 * A block with its images section read off: what stands before it, and the
 * identity of each image it names. The section is the last thing a block
 * holds, so a block with none is answered whole and naming nothing.
 */
export function threadImagesRead(block: string): {
  readonly before: string;
  readonly artifacts: readonly string[];
} {
  const opens = block.startsWith(`${threadImagesHeading}\n\n`)
    ? 0
    : block.lastIndexOf(`\n\n${threadImagesHeading}\n\n`);
  if (opens < 0) return { before: block, artifacts: [] };
  const lines = block.slice(opens).trim().split("\n").slice(1);
  return {
    before: block.slice(0, opens),
    artifacts: lines.flatMap((line) => {
      const ends = line.indexOf(threadImageFieldSeparator);
      return line.startsWith("- ") && ends > 2 ? [line.slice(2, ends)] : [];
    }),
  };
}

/**
 * The line every block recorded before that heading existed ended on, and so
 * the older boundary a reader splits on where the heading is absent. It is
 * written out rather than taken from `threadStandingRulesDefault`, because the
 * turns it splits are frozen text and that default is now a project's to
 * reword.
 */
export const threadTurnRecordedLastLine =
  "- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.";

/** The standing rules under their heading, which is the last section of both
 * the objectives and the seeding block. */
export function threadStandingSection(standing: string): string {
  return `${threadStandingHeading}\n\n${standing}`;
}

/**
 * Every heading a turn's input can open with: the seeding block's own four, on
 * a thread's first turn, and `threadPageHeading` and `threadImagesHeading`, on
 * a later turn that names a page or an image. A reader checks the whole list
 * rather than the seeding block's own, which is what lets it split a later
 * turn's sections off correctly without being told the turn carries one.
 */
export const threadSeedingHeadings = [
  threadNorthStarHeading,
  threadDraftsHeading,
  threadRefusalsHeading,
  threadStandingHeading,
  threadPageHeading,
  threadImagesHeading,
] as const;
