/**
 * The briefing templates: the two roles this tree knows how to brief, the fixed
 * sequence of sections a briefing is made of, and the standing wording each
 * role's own sections carry.
 *
 * THE WORDING BELOW IS AUTHORED AND IS A FIRST WORDING. Issue #97 fixes the
 * ownership, the sections and their order and deliberately does not choose what
 * the templates say; nothing in this tree can derive that, so it is written
 * here to be read, argued with and replaced. `briefingTemplateVersion` is what
 * a later wording moves, and every rendered briefing records the version it was
 * rendered from — so a prompt that turns out to have been badly worded can be
 * found rather than guessed at.
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
 * THE ROLE VOCABULARY IS `Work` AND `Review`. #97 floats `Code` and `Review` as
 * one plausible first vocabulary and does not choose; #143 asks for `Work` and
 * `Review`, and #97's own practice scope is already spelled `Work`, `Review`
 * and `Both`. Two spellings of one distinction is the thing worth avoiding, so
 * this is the one the tree uses and a reviewer may overrule it.
 */

/** The role a briefing is written for, which is also the role a practice is scoped to. */
export type TaskPurpose = "Work" | "Review";

/** Every purpose, so a suite and a resolver iterate rather than restate. */
export const allTaskPurposes: readonly TaskPurpose[] = ["Work", "Review"];

/** The sections a briefing is made of, named so a rendered one can be inspected by identity. */
export type BriefingSectionId =
  | "RoleInstructions"
  | "WhyItMatters"
  | "AcceptanceAndConstraints"
  | "PurposeInstructions"
  | "Practices"
  | "RuntimeContext"
  | "RequiredResult";

/** The fixed order #97 pins, and the only statement of it in this tree. */
export const briefingSectionOrder: readonly BriefingSectionId[] = [
  "RoleInstructions",
  "WhyItMatters",
  "AcceptanceAndConstraints",
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
export const briefingTemplateVersion = 1;

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
    case "PurposeInstructions":
      return purpose === "Work"
        ? "Implementation instructions"
        : "Review focus";
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
        "Judge it against the acceptance criteria and constraints below, and against nothing you would merely have preferred.",
        "If the change satisfies every criterion, say so; a finding that names no criterion is not a finding.",
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
  }
}
