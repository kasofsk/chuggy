/**
 * Whether a Pending ticket that follows its configuration's newest revision
 * moves to the revision a repository's head declares under the same name.
 *
 * THE ANSWER IS ABOUT WHAT THE TICKET RUNS, NOT WHICH COMMIT NAMED IT. A head
 * declaring the same configuration under a new commit, or changing only
 * workloads the ticket's selection does not reach, leaves it `Current`. What
 * it runs is the definition its release resolves, and beside it the three
 * things of a catalog no definition folds: the selected finalizer, the names of
 * the plan's stages and the catalog's outputs. A difference in any of them
 * `Moves` the ticket, onto the head's default program for its selected plan.
 *
 * A TRIMMED TICKET STAYS. A program running less than its plan was signed off
 * against the plan it saw, so it is answered before the head is read at all.
 *
 * A REVISION NOT READY FOR THE TICKET HOLDS IT, the held one or the head's,
 * with the fault a release would be refused for. Nothing here remembers that
 * answer: asked again of a later head, it is answered again.
 */

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import {
  configurationFollowingOf,
  type ConfigurationSelection,
} from "../contract/configurationSelection.ts";
import type { TicketFollowing } from "../contract/responses.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  declaredConfigurationVersion,
  draftInitializationProgram,
  draftReleaseReadiness,
  draftReleaseRefusalCode,
  releaseConfigurationReadiness,
  ticketConfigurationReadiness,
  ticketProgramShort,
  type CanonicalConfiguration,
  type ReleaseConfigurationFault,
  type TicketConfiguration,
} from "./authoring.ts";
import type { ReleaseAuthoringProgram } from "../contract/authoring.ts";
import type { RepositoryId } from "./finalizer.ts";
import { parkedOverridesDefinitionDigest } from "./parkedOverrides.ts";
import type { DraftBrief } from "./ticketBrief.ts";
import { materialDigest } from "./ticketDefinition.ts";

/** One released ticket as it stands, with the revision it holds and the one its repository's head declares under the same name. */
export interface ConfigurationFollowingTicket {
  readonly held: CanonicalConfiguration;
  readonly head: CanonicalConfiguration;
  readonly brief: DraftBrief | undefined;
  readonly overrides: ConfigurationOverrides | undefined;
  readonly selection: ConfigurationSelection | undefined;
  readonly program: ReleaseAuthoringProgram;
  readonly dependencies: ReadonlySet<number>;
  /** The repository both revisions were imported from. */
  readonly repository: RepositoryId;
}

export type ConfigurationFollowingVerdict =
  | { readonly verdict: "Current" }
  | { readonly verdict: "Moves"; readonly program: ReleaseAuthoringProgram }
  | { readonly verdict: "Held"; readonly fault: ReleaseConfigurationFault }
  | { readonly verdict: "Trimmed" };

/** What a catalog ticket runs that its definition does not fold, as one digest; a document has none of it. */
function configurationFollowingSurface(ticket: TicketConfiguration): string {
  return ticket.version === 1
    ? materialDigest({})
    : materialDigest({
        finalizer: ticket.selection.finalizer,
        stages: ticket.selection.plan.stages.map((stage) => stage.name),
        outputs: ticket.configuration.outputs,
      });
}

/** The digest of the definition one revision resolves under one program, or the fault where it resolves none. */
function configurationFollowingDigest(
  ticket: ConfigurationFollowingTicket,
  configuration: CanonicalConfiguration,
  program: ReleaseAuthoringProgram,
): ReturnType<typeof parkedOverridesDefinitionDigest> {
  return parkedOverridesDefinitionDigest(
    {
      configuration,
      configurationRepository: {
        from: "Imported",
        repository: ticket.repository,
      },
      authoring: { deps: ticket.dependencies, prog: program },
      brief: ticket.brief,
      selection: ticket.selection,
    },
    ticket.overrides,
  );
}

/** Judges the held revision, the trim, the head's readiness under its default program, and then what the ticket would run. */
export function configurationFollowingVerdict(
  ticket: ConfigurationFollowingTicket,
): ConfigurationFollowingVerdict {
  const held = ticketConfigurationReadiness(
    ticket.held,
    ticket.brief,
    ticket.overrides,
    ticket.selection,
  );
  if (held.readiness === "Incomplete")
    return { verdict: "Held", fault: held.fault };
  if (ticketProgramShort(held.ticket, ticket.program))
    return { verdict: "Trimmed" };
  if (declaredConfigurationVersion(JSON.parse(ticket.head)) !== 2)
    return { verdict: "Held", fault: "SelectionUnsupported" };
  const selected = ticketConfigurationReadiness(
    ticket.head,
    ticket.brief,
    ticket.overrides,
    ticket.selection,
  );
  if (selected.readiness === "Incomplete")
    return { verdict: "Held", fault: selected.fault };
  if (selected.ticket.version !== 2)
    throw new RangeError(
      "configuration following: a catalog read as a document",
    );
  const program = draftInitializationProgram(undefined, selected.ticket);
  const head = draftReleaseReadiness(
    ticket.head,
    ticket.brief,
    { from: "Imported", repository: ticket.repository },
    ticket.overrides,
    ticket.selection,
    program,
  );
  if (head.readiness === "Incomplete")
    return { verdict: "Held", fault: head.fault };
  const kept = configurationFollowingDigest(
    ticket,
    ticket.held,
    ticket.program,
  );
  if (kept.resolved === "Unready")
    return { verdict: "Held", fault: kept.fault };
  const moved = configurationFollowingDigest(ticket, ticket.head, program);
  if (moved.resolved === "Unready")
    return { verdict: "Held", fault: moved.fault };
  return kept.digest === moved.digest &&
    configurationFollowingSurface(held.ticket) ===
      configurationFollowingSurface(head.ticket)
    ? { verdict: "Current" }
    : { verdict: "Moves", program };
}

/**
 * What a ticket's own read says of its following: the verdict the importer
 * would reach against `head`, a held one under the code a release would be
 * refused with, and nothing where the ticket's choice, then its held catalog's
 * default, pins it.
 */
export function configurationFollowingRead(
  ticket: ConfigurationFollowingTicket,
): TicketFollowing | undefined {
  const declared = releaseConfigurationReadiness(ticket.held);
  const defaults =
    declared.readiness === "Ready" && declared.configuration.version === 2
      ? declared.configuration.defaults
      : undefined;
  if (configurationFollowingOf(ticket.selection, defaults) !== "Latest")
    return undefined;
  const followed = configurationFollowingVerdict(ticket);
  switch (followed.verdict) {
    case "Current":
    case "Trimmed":
      return { verdict: followed.verdict };
    case "Moves":
      return { verdict: "Moves" };
    case "Held":
      return { verdict: "Held", code: draftReleaseRefusalCode(followed.fault) };
    default:
      return assertNever(followed);
  }
}
