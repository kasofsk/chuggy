/**
 * What a launched worker is actually handed: the pinned ticket configuration
 * read back by revision, the blessed practices in scope for its role, the
 * bounded runtime facts the adapter gathered, and the one authority it runs
 * under.
 *
 * COMPOSITION IS PURE AND ITS READS ARE GATHERED FIRST. `BriefingView` is every
 * input, and `composeTaskInvocation` is a synchronous function of it, so the
 * launch path awaits its ports before it decides and never inside the decision.
 *
 * THE SAME BRIEF REACHES BOTH ROLES. Motivation, acceptance criteria and
 * constraints are one value on the configuration and are rendered by both
 * templates, so a review tests the work against the claim the work set out to
 * satisfy rather than against a second description of it. Only the
 * purpose-specific block and the scoped practices differ between them.
 *
 * A RETRY RENDERS THE SAME BRIEFING BECAUSE THE INPUT IS CONTENT-ADDRESSED.
 * `PinnedConfigurationPort` can only be asked for a named revision — there is
 * no call on it that means "current" — and what comes back is refused unless
 * its own revision and digest are the ones the durable execution row pinned at
 * registration. So a moving ticket row cannot reach a second attempt, and a
 * silently rewritten revision is a refusal rather than a different prompt.
 *
 * AUTHORITY IS NEVER COMPOSED FROM PROSE. `./taskAuthority.ts` holds the whole
 * of it, the requests folded into it are structured data, and a rendered
 * briefing has no authority field for a later block to raise. The template's
 * own request leads that fold and takes completion authority away: a briefed
 * worker reports a manifest and the scheduler submits the completion, so no
 * grant and no authored block can leave a worker able to conclude a task
 * itself.
 *
 * A RUNTIME FACT CANNOT FORGE A SECTION. Every line rendered here is refused if
 * it carries a control character, so a handoff from an earlier agent cannot
 * open a heading of its own, and it could gain nothing by it if it could —
 * headings are not read back and authority is not prose.
 *
 * A RENDERED BRIEFING CARRIES A SEAL, AND THE SEAL IS A COMPILE-TIME CLAIM. Its
 * value is not exported, so a literal assembled out of headings and lines is
 * not a `RenderedBriefing`: the compiler refuses it for the missing field, and
 * no expression outside this module supplies one. It is not a runtime check,
 * because a module already holding a briefing this module rendered can spread
 * it into a value carrying the same seal. Nothing reads the seal back, so such
 * a value is inert — what a launch acts on is the authority beside the
 * briefing, and `./taskAuthority.ts` holds that behind a key of its own.
 *
 * WHAT IS RETAINED IS `BriefingProvenance` AND NOTHING ELSE. It holds the
 * template version, the pinned revision and digest, the resolved practice
 * identities and each rendered section's identity and size. There is no field
 * on it that can hold a rendered prompt, a credential or source material,
 * which is how the retention rule is kept rather than remembered.
 *
 * A REFUSAL IS `TicketConfigIncompatible` AND THE FAULT SAYS WHICH. The reason
 * vocabulary is the model's and is closed; `BriefingFault` is this module's
 * bounded diagnostic beside it, and `./executionSchedulerRun.ts` observes it at
 * the block it causes — so a blocked ticket can be explained without widening
 * what `Core` understands.
 */

import type { ConfigurationPin } from "./projectDecision.ts";
import type { Partition } from "./projectStore.ts";
import type { ExecutionId } from "./schedulerIdentity.ts";
import {
  authoredTaskConfigurationReadiness,
  allPracticeIds,
  briefingLinesMax,
  taskConfigurationLineFault,
  type AuthoredTaskConfiguration,
  type EvaluationBlock,
  type PurposeBlock,
  type PracticeId,
  type TaskConfigurationFault,
  type TaskConfigurationReadFault,
  type TicketBrief,
} from "./taskConfiguration.ts";
export {
  authoredTaskConfigurationReadiness,
  allPracticeIds,
  briefingLineCharsMax,
  briefingLinesMax,
  type AuthoredTaskConfiguration,
  type EvaluationBlock,
  type PurposeBlock,
  type PracticeId,
  type TaskConfigurationFault,
  type TaskConfigurationReadFault,
  type TicketBrief,
} from "./taskConfiguration.ts";
import {
  briefingHeading,
  briefingLabels,
  briefingRequiredResult,
  briefingRoleInstructions,
  briefingSectionOrder,
  briefingTemplateVersion,
  type BriefingSectionId,
  type TaskPurpose,
} from "./briefingTemplate.ts";
import {
  resolveTaskAuthority,
  type AuthorityRequest,
  type PolicyAuthorityGrant,
  type TaskAuthority,
} from "./taskAuthority.ts";

/** Which roles a practice speaks to, which is what makes one shared list serve both. */
export type PracticeScope = "Work" | "Review" | "Both";

/** One blessed practice: what it tells an agent to do, and whose briefing it belongs in. */
export interface BlessedPractice {
  readonly practice: PracticeId;
  readonly scope: PracticeScope;
  readonly instruction: string;
}

/** The finite trusted catalog a configured practice name is resolved through. */
export type PracticeCatalog = ReadonlyMap<PracticeId, BlessedPractice>;

/** The practices this tree blesses, whose wording is authored like the templates' and revisable like it. */
const blessedPractices: readonly BlessedPractice[] = [
  {
    practice: "RegressionCoverage",
    scope: "Work",
    instruction:
      "Add or extend a test that fails without this change and passes with it.",
  },
  {
    practice: "ChangedCallPaths",
    scope: "Review",
    instruction:
      "Walk every call path the change reaches, including the callers the diff does not show.",
  },
  {
    practice: "AcceptanceCriteria",
    scope: "Both",
    instruction:
      "Take the acceptance criteria one at a time and say which of them the change meets.",
  },
];

/** The finite catalog a configured practice name is resolved through, keyed by identity. */
export const blessedPracticeCatalog: PracticeCatalog = new Map(
  blessedPractices.map((practice) => [practice.practice, practice]),
);

/** One immutable authored configuration revision, as the release pinned it. */
export interface PinnedTaskConfiguration
  extends ConfigurationPin, AuthoredTaskConfiguration {}

/** Adds the immutable storage identity to an authored briefing that parsed successfully. */
export function pinnedTaskConfigurationReadiness(
  value: unknown,
  pin: ConfigurationPin,
):
  | {
      readonly readiness: "Ready";
      readonly configuration: PinnedTaskConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: TaskConfigurationFault;
    } {
  const authored = authoredTaskConfigurationReadiness(value);
  return authored.readiness === "Incomplete"
    ? authored
    : {
        readiness: "Ready",
        configuration: { ...pin, ...authored.configuration },
      };
}

/** What the adapter observed of the world, which is data and never authored prompt text. */
export interface RuntimeFacts {
  readonly workspace?: string;
  readonly changedFiles: readonly string[];
  readonly handoff: readonly string[];
}

/** The most changed files a runtime context may name before it stops being context. */
export const runtimeChangedFilesMax = 64;

/** The most handoff lines runtime context may carry. */
export const runtimeHandoffLinesMax = 32;

/** Why a briefing could not be composed, each of them a fact about the pinned configuration. */
export type BriefingFault =
  | "RevisionMismatch"
  | "DigestMismatch"
  | "UnknownPractice"
  | "DuplicatePractice"
  | "EmptyBrief"
  | "EmptyLine"
  | "TextTooLong"
  | "TextUnreadable"
  | "TooManyLines"
  | "StageNotCovered";

/** Every fault, so a suite iterates rather than restates. */
export const allBriefingFaults: readonly BriefingFault[] = [
  "RevisionMismatch",
  "DigestMismatch",
  "UnknownPractice",
  "DuplicatePractice",
  "EmptyBrief",
  "EmptyLine",
  "TextTooLong",
  "TextUnreadable",
  "TooManyLines",
  "StageNotCovered",
];

/** What one line has to be to render: present, bounded, and free of anything a terminal eats. */
function briefingLineFault(line: string): BriefingFault | undefined {
  return taskConfigurationLineFault(line);
}

/** What one list has to be to render, which is bounded and made of renderable lines. */
function briefingLinesFault(
  lines: readonly string[],
  linesMax: number,
): BriefingFault | undefined {
  if (lines.length > linesMax) return "TooManyLines";
  for (const line of lines) {
    const fault = briefingLineFault(line);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/** The first fault in any of these lists, so one loop covers every authored slot. */
function briefingListsFault(
  lists: readonly (readonly [readonly string[], number])[],
): BriefingFault | undefined {
  for (const [lines, linesMax] of lists) {
    const fault = briefingLinesFault(lines, linesMax);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/** Whether a practice scoped this way belongs in a briefing written for this role. */
function practiceInScope(scope: PracticeScope, purpose: TaskPurpose): boolean {
  return scope === "Both" || scope === purpose;
}

/**
 * The practices in scope for one role, or the fault the configured list earned.
 * The refusal names no configured string, because an unknown name is arbitrary
 * text and a retained diagnostic is bounded.
 */
export type PracticesResolved =
  | {
      readonly resolved: "Practices";
      readonly practices: readonly BlessedPractice[];
    }
  | { readonly resolved: "Refused"; readonly fault: BriefingFault };

/** Resolves every configured practice name through the catalog, keeping the ones this role reads. */
export function resolvePractices(
  catalog: PracticeCatalog,
  purpose: TaskPurpose,
  named: readonly string[],
): PracticesResolved {
  const seen = new Set<string>();
  const found: BlessedPractice[] = [];
  for (const name of named) {
    if (seen.has(name)) {
      return { resolved: "Refused", fault: "DuplicatePractice" };
    }
    seen.add(name);
    const identity = allPracticeIds.find((known) => known === name);
    const blessed = identity === undefined ? undefined : catalog.get(identity);
    if (blessed === undefined) {
      return { resolved: "Refused", fault: "UnknownPractice" };
    }
    if (practiceInScope(blessed.scope, purpose)) found.push(blessed);
  }
  found.sort(
    (left, right) =>
      allPracticeIds.indexOf(left.practice) -
      allPracticeIds.indexOf(right.practice),
  );
  return { resolved: "Practices", practices: found };
}

/** What reading a pinned revision found, keeping a definitive absence apart from an outage. */
export type ConfigurationRead =
  | {
      readonly read: "Configuration";
      readonly configuration: PinnedTaskConfiguration;
    }
  | { readonly read: "Missing" }
  | {
      readonly read: "Incompatible";
      readonly fault: TaskConfigurationReadFault;
    }
  | { readonly read: "Unavailable" };

/**
 * The immutable authoring revisions, behind a typed port. Every call names the
 * revision it wants, so there is no way to spell a read of the current one.
 */
export interface PinnedConfigurationPort {
  configuration(
    partition: Partition,
    pin: ConfigurationPin,
  ): Promise<ConfigurationRead>;
}

/** What gathering the runtime facts found, an outage kept apart from an empty context. */
export type RuntimeFactsRead =
  | { readonly read: "Facts"; readonly facts: RuntimeFacts }
  | { readonly read: "Unavailable" };

/** What the fabric can observe about one execution's workspace, behind a typed port. */
export interface RuntimeFactsPort {
  facts(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<RuntimeFactsRead>;
}

/** Everything composition reads, gathered before it runs so nothing is awaited inside it. */
export interface BriefingView {
  readonly purpose: TaskPurpose;
  readonly stage?: number;
  readonly pin: ConfigurationPin;
  readonly configuration: PinnedTaskConfiguration;
  readonly runtime: RuntimeFacts;
  readonly grant: PolicyAuthorityGrant;
}

/** The block one role reads, which is the only part of a configuration the two roles differ on. */
function purposeBlock(
  configuration: PinnedTaskConfiguration,
  purpose: TaskPurpose,
  stage?: number,
): PurposeBlock | EvaluationBlock | undefined {
  if (purpose === "Work") return configuration.work;
  if (configuration.evaluations === undefined) return configuration.review;
  return stage === undefined ? undefined : configuration.evaluations[stage];
}

function purposePractices(view: BriefingView): readonly string[] | undefined {
  const block = purposeBlock(view.configuration, view.purpose, view.stage);
  if (block === undefined) return undefined;
  return "practices" in block ? block.practices : view.configuration.practices;
}

/** Whether the revision that came back is the one the durable execution row pinned. */
function briefingPinFault(view: BriefingView): BriefingFault | undefined {
  if (
    view.configuration.configurationRevision !== view.pin.configurationRevision
  ) {
    return "RevisionMismatch";
  }
  if (view.configuration.configurationDigest !== view.pin.configurationDigest) {
    return "DigestMismatch";
  }
  return undefined;
}

/** What the pinned configuration has to be to render, the empty brief included. */
function briefingConfigurationFault(
  view: BriefingView,
): BriefingFault | undefined {
  const pinned = briefingPinFault(view);
  if (pinned !== undefined) return pinned;
  const block = purposeBlock(view.configuration, view.purpose, view.stage);
  if (block === undefined) return "StageNotCovered";
  const brief = view.configuration.brief;
  if (brief.motivation.length === 0 && brief.acceptanceCriteria.length === 0) {
    return "EmptyBrief";
  }
  return briefingListsFault([
    [brief.motivation, briefingLinesMax],
    [brief.acceptanceCriteria, briefingLinesMax],
    [brief.constraints, briefingLinesMax],
    [block.instructions, briefingLinesMax],
  ]);
}

/** What the gathered runtime facts have to be to render, which is bounded and printable. */
function briefingRuntimeFault(
  runtime: RuntimeFacts,
): BriefingFault | undefined {
  return briefingListsFault([
    [runtime.workspace === undefined ? [] : [runtime.workspace], 1],
    [runtime.changedFiles, runtimeChangedFilesMax],
    [runtime.handoff, runtimeHandoffLinesMax],
  ]);
}

/** One list member as it renders, which is the only list shape a briefing has. */
function briefingBullet(line: string): string {
  return `- ${line}`;
}

/** A labelled list, or nothing at all when there is nothing to label. */
function briefingLabelled(
  label: string,
  lines: readonly string[],
): readonly string[] {
  return lines.length === 0 ? [] : [label, ...lines.map(briefingBullet)];
}

/** The acceptance criteria and the constraints, each labelled and each free to be absent. */
function briefingCriteriaLines(brief: TicketBrief): readonly string[] {
  return [
    ...briefingLabelled(
      briefingLabels.acceptanceCriteria,
      brief.acceptanceCriteria,
    ),
    ...briefingLabelled(briefingLabels.constraints, brief.constraints),
  ];
}

/** The runtime facts as lines, each of them absent when the adapter observed nothing. */
function briefingRuntimeLines(runtime: RuntimeFacts): readonly string[] {
  return [
    ...(runtime.workspace === undefined
      ? []
      : [`${briefingLabels.workspace} ${runtime.workspace}`]),
    ...briefingLabelled(briefingLabels.changedFiles, runtime.changedFiles),
    ...briefingLabelled(briefingLabels.handoff, runtime.handoff),
  ];
}

/** A body for every section identity, which is what makes the order below a filter. */
function briefingBodies(
  view: BriefingView,
  practices: readonly BlessedPractice[],
): Record<BriefingSectionId, readonly string[]> {
  return {
    RoleInstructions: briefingRoleInstructions(view.purpose),
    WhyItMatters: view.configuration.brief.motivation,
    AcceptanceAndConstraints: briefingCriteriaLines(view.configuration.brief),
    PurposeInstructions:
      purposeBlock(view.configuration, view.purpose, view.stage)
        ?.instructions ?? [],
    Practices: practices.map((practice) =>
      briefingBullet(practice.instruction),
    ),
    RuntimeContext: briefingRuntimeLines(view.runtime),
    RequiredResult: briefingRequiredResult(view.purpose),
  };
}

/** One rendered section, carrying the identity it was rendered from. */
export interface BriefingSection {
  readonly section: BriefingSectionId;
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * The seal a rendered briefing carries, whose value this module does not
 * export. What it does and does not prevent is in the header above.
 */
const briefingSeal = Symbol("chuggy:rendered-briefing");

/** One rendered briefing, sealed so a bare sequence of blocks cannot be offered as one. */
export interface RenderedBriefing {
  readonly seal: typeof briefingSeal;
  readonly purpose: TaskPurpose;
  readonly templateVersion: number;
  readonly sections: readonly BriefingSection[];
  readonly text: string;
}

/** Whether these sections are the fixed order with members removed, which is the postcondition. */
function briefingSectionsOrdered(
  sections: readonly BriefingSection[],
): boolean {
  let placed = -1;
  for (const section of sections) {
    const at = briefingSectionOrder.indexOf(section.section);
    if (at <= placed) return false;
    placed = at;
  }
  return true;
}

/** One section as text, heading first, which is also what its retained size is measured over. */
function briefingSectionText(section: BriefingSection): string {
  return [`## ${section.heading}`, ...section.lines].join("\n");
}

/** Renders the sections that have a body, in the one order this tree states. */
export function renderBriefing(
  view: BriefingView,
  practices: readonly BlessedPractice[],
): RenderedBriefing {
  const bodies = briefingBodies(view, practices);
  const sections = briefingSectionOrder
    .filter((section) => bodies[section].length > 0)
    .map((section) => ({
      section,
      heading: briefingHeading(section, view.purpose),
      lines: bodies[section],
    }));
  if (!briefingSectionsOrdered(sections)) {
    throw new RangeError(
      "task briefing: the rendered sections are not the fixed order with members removed",
    );
  }
  return {
    seal: briefingSeal,
    purpose: view.purpose,
    templateVersion: briefingTemplateVersion,
    sections,
    text: sections.map(briefingSectionText).join("\n\n"),
  };
}

/** One rendered section as the provenance row records it, which is its identity and its size. */
export interface BriefingProvenanceSection {
  readonly section: BriefingSectionId;
  readonly chars: number;
}

/**
 * The bounded row a launch retains. It has no field a rendered prompt, a
 * credential or a piece of source material could be put in.
 */
export interface BriefingProvenance extends ConfigurationPin {
  readonly templateVersion: number;
  readonly purpose: TaskPurpose;
  readonly practices: readonly PracticeId[];
  readonly sections: readonly BriefingProvenanceSection[];
}

/** The provenance of one rendered briefing, which is what obligation 14 asks be kept. */
function briefingProvenance(
  briefing: RenderedBriefing,
  pin: ConfigurationPin,
  practices: readonly BlessedPractice[],
): BriefingProvenance {
  return {
    configurationRevision: pin.configurationRevision,
    configurationDigest: pin.configurationDigest,
    templateVersion: briefing.templateVersion,
    purpose: briefing.purpose,
    practices: practices.map((practice) => practice.practice),
    sections: briefing.sections.map((section) => ({
      section: section.section,
      chars: briefingSectionText(section).length,
    })),
  };
}

/** The narrowing every briefing leads with: a briefed worker reports a result and completes nothing. */
export const briefingAuthorityFloor: AuthorityRequest = {
  mayCompleteTask: false,
};

/** Every structured request one composition folds, the template's own first. */
function briefingAuthorityRequests(
  view: BriefingView,
): readonly AuthorityRequest[] {
  const shared = view.configuration.authority;
  const block = purposeBlock(
    view.configuration,
    view.purpose,
    view.stage,
  )?.authority;
  return [
    briefingAuthorityFloor,
    ...(shared === undefined ? [] : [shared]),
    ...(block === undefined ? [] : [block]),
  ];
}

/** What a launched worker receives: what to do, what it may do, and what was retained about both. */
export interface TaskInvocation {
  readonly briefing: RenderedBriefing;
  readonly authority: TaskAuthority;
  readonly provenance: BriefingProvenance;
}

/** What composing one invocation found, the refusal a value like every other here. */
export type TaskComposed =
  | { readonly composed: "Composed"; readonly invocation: TaskInvocation }
  | { readonly composed: "Blocked"; readonly fault: BriefingFault };

/** Composes one role's invocation from the pinned configuration and the gathered facts. */
export function composeTaskInvocation(
  catalog: PracticeCatalog,
  view: BriefingView,
): TaskComposed {
  const fault =
    briefingConfigurationFault(view) ?? briefingRuntimeFault(view.runtime);
  if (fault !== undefined) return { composed: "Blocked", fault };
  const resolved = resolvePractices(
    catalog,
    view.purpose,
    purposePractices(view) ?? [],
  );
  if (resolved.resolved === "Refused") {
    return { composed: "Blocked", fault: resolved.fault };
  }
  const briefing = renderBriefing(view, resolved.practices);
  return {
    composed: "Composed",
    invocation: {
      briefing,
      authority: resolveTaskAuthority(
        view.grant,
        briefingAuthorityRequests(view),
      ),
      provenance: briefingProvenance(briefing, view.pin, resolved.practices),
    },
  };
}
