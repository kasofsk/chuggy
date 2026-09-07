/**
 * The fixed text a thread's first turn carries in front of the member's
 * message, and the headings it is written under.
 *
 * IT IS THE CONTRACT BECAUSE TWO SIDES READ IT. The interpreter composes the
 * block from these constants and the console splits the composed input back
 * apart on them, so a chat draws the member's own words rather than a document
 * they never typed. A copy of the sentences on the reading side would be a
 * split that goes wrong the day the writing side is reworded, silently, on
 * every thread's first turn.
 *
 * `threadSeedingFixedCharsMax` in `http.ts` is the ceiling this is held under.
 */

/**
 * The sentence a woken thread is bound by. It is written once and read in both
 * places that must say it, so the rule written twice cannot become two rules.
 */
export const threadWakeStanding =
  "A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.";

/**
 * Which channel a thread's commands go through, written once for the same
 * reason. A project tool is a command its owner already has; the lead's
 * decisions are the lead's, and a thread neither makes nor amends one.
 */
export const threadChannelStanding =
  "You act through the same commands your owner has in the console, recorded as their act; the lead's decisions are the lead's, and you neither make nor amend one.";

export const threadNorthStarHeading = "# North Star";
export const threadDraftsHeading = "# Your open drafts";
export const threadRefusalsHeading = "# Standing against them";
export const threadStandingHeading = "# How you act on this project";

/** The two standing rules under their heading, which is the last section of
 * both the objectives and the seeding block. */
export const threadStandingSection = `${threadStandingHeading}

- ${threadChannelStanding}
- ${threadWakeStanding}`;

/** The last line of every seeding block, and so the line a reader splits the
 * member's message off after. */
export const threadSeedingLastLine = `- ${threadWakeStanding}`;

/**
 * Every heading a seeding block can open with. The block sheds its middle
 * sections to fit and a project may have no North Star, so which one comes
 * first is not fixed — that any of them does is.
 */
export const threadSeedingHeadings = [
  threadNorthStarHeading,
  threadDraftsHeading,
  threadRefusalsHeading,
  threadStandingHeading,
] as const;
