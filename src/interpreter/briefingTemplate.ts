/**
 * The briefing templates: the two roles this tree knows how to brief, the fixed
 * sequence of sections a briefing is made of, and the standing wording each
 * role's own sections carry.
 *
 * THE WORDING BELOW IS AUTHORED AND NOTHING DERIVES IT. It is data this module
 * states rather than a function of anything else in the tree, so the only thing
 * that can be true of it mechanically is that it has not changed without saying
 * so: `briefingTemplateVersion` is the revision every rendered briefing records,
 * and `test/interpreter/briefingTemplate.test.ts` pins a digest of every string
 * below beside it, so an edit that leaves the version where it is fails there.
 * A briefing whose wording turns out to be wrong is therefore found by its
 * recorded version rather than guessed at.
 *
 * A TEMPLATE OWNS A ROLE AND TICKET DATA FILLS ITS SLOTS, which is the shape
 * #97 settles against a caller assembling a sequence of blocks. The two
 * sections below are the ones no ticket may write — what the agent is and what
 * it must report — and they are the two that are never empty, so a briefing
 * that carries nothing else still says who is reading it and what comes back.
 *
 * THE ORDER IS ONE ARRAY AND NOT A SEQUENCE OF STATEMENTS. `./taskBriefing.ts`
 * builds a body for every section identity, then walks `briefingSectionOrder`
 * and drops the empty ones. A section's position is therefore a fact about this
 * array alone, which is what makes an absent optional section unable to
 * reorder its neighbours: filtering preserves relative order, so the rendered
 * sequence is always this one with members removed.
 *
 * THE ROLE VOCABULARY IS `Work` AND `Review`, and it is the same one
 * `./taskBriefing.ts` scopes a practice by and `./executionScheduler.ts` maps a
 * task kind onto. One spelling serves all three, so a practice scoped `Review`
 * and a briefing written for `Review` are the same value rather than two that
 * have to be kept in step.
 */

/** The role a briefing is written for, which is also the role a practice is scoped to. */
export type TaskPurpose = "Work" | "Review" | "Check";

/** Every purpose, so a suite and a resolver iterate rather than restate. */
export const allTaskPurposes: readonly TaskPurpose[] = [
  "Work",
  "Review",
  "Check",
];

/** The sections a briefing is made of, named so a rendered one can be inspected by identity. */
export type BriefingSectionId =
  | "RoleInstructions"
  | "WhyItMatters"
  | "AcceptanceAndConstraints"
  | "PriorWorkReports"
  | "PurposeInstructions"
  | "Practices"
  | "RuntimeContext"
  | "RequiredResult";

/** The fixed order #97 pins, and the only statement of it in this tree. */
export const briefingSectionOrder: readonly BriefingSectionId[] = [
  "RoleInstructions",
  "WhyItMatters",
  "AcceptanceAndConstraints",
  "PriorWorkReports",
  "PurposeInstructions",
  "Practices",
  "RuntimeContext",
  "RequiredResult",
];

/** The sections a template owns outright, which are the ones that are never empty. */
export const briefingTemplateSections: readonly BriefingSectionId[] = [
  "RoleInstructions",
  "RequiredResult",
];

/** The wording revision every rendered briefing records, moved by any edit to the text below. */
export const briefingTemplateVersion = 2;

/** The heading one section renders under, which is the only one that varies by role. */
export function briefingHeading(
  section: BriefingSectionId,
  purpose: TaskPurpose,
): string {
  switch (section) {
    case "RoleInstructions":
      return "Your role";
    case "WhyItMatters":
      return "Why this ticket matters";
    case "AcceptanceAndConstraints":
      return "Acceptance criteria and constraints";
    case "PriorWorkReports":
      return "Reports from the work tasks";
    case "PurposeInstructions":
      return purpose === "Work"
        ? "Implementation instructions"
        : purpose === "Review"
          ? "Review focus"
          : "Check instructions";
    case "Practices":
      return "Practices for this task";
    case "RuntimeContext":
      return "Runtime context";
    case "RequiredResult":
      return "The result you must report";
  }
}

/** The labels a rendered section puts in front of a list, which is wording like the rest. */
export const briefingLabels = {
  acceptanceCriteria: "Acceptance criteria:",
  constraints: "Constraints:",
  workspace: "Workspace:",
  changedFiles: "Changed files:",
  handoff: "Handoff from the earlier task:",
  workReports: "Worker reports:",
} as const;

/** The standing responsibilities of the role, which no ticket may edit. */
export function briefingRoleInstructions(
  purpose: TaskPurpose,
): readonly string[] {
  switch (purpose) {
    case "Work":
      return [
        "You are implementing one task on this ticket, and nothing else on it.",
        "Read the code you are about to change before you change it.",
        "Change the least that satisfies the acceptance criteria below, and leave the rest alone.",
        "If the ticket cannot be satisfied as written, report that rather than satisfying something adjacent to it.",
      ];
    case "Review":
      return [
        "You are reviewing a change made for this ticket, and you did not write it.",
        "Read the change itself rather than its author's account of what it does.",
        "Review code only: do not run tests or commands, and do not treat reported test results as proof.",
        "A separate CI evaluation owns executable checks; this review owns correctness found by reading.",
        "Judge it against the acceptance criteria and constraints below, and against nothing you would merely have preferred.",
        "If the change satisfies every criterion, say so; a finding that names no criterion is not a finding.",
      ];
    case "Check":
      return [
        "You are running the separate executable check stage for this ticket.",
        "Run only the commands named below and judge their actual exit status.",
        "Exit 2 means the check could not run and is not a pass.",
      ];
  }
}

/** What the role must report, which is what the scheduler will read back as a result. */
export function briefingRequiredResult(
  purpose: TaskPurpose,
): readonly string[] {
  switch (purpose) {
    case "Work":
      return [
        "Report one result manifest: a verdict, and a handoff for anything the reviewer will need.",
        "Report a pass only for work you have verified running; an unverified pass is a false verdict.",
        "Report a failure plainly, with the criterion you could not satisfy and what stopped you.",
      ];
    case "Review":
      return [
        "Report one result manifest: a verdict, and one finding for each criterion or constraint the change fails.",
        "Give every finding a file, a line and the criterion or constraint it fails.",
        "Report a pass only when every criterion above is met by the change as it stands.",
      ];
    case "Check":
      return [
        "Report one result manifest with the command and its actual exit status.",
        "Report a pass only when every requested command exits cleanly.",
      ];
  }
}
