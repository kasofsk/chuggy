/**
 * Whether an escalated ticket may take the overrides offered for it: the
 * effective configuration is ready, and the definition it resolves is the one
 * the overrides it holds resolve.
 *
 * THE FOLD DECIDES, NOT A LIST. Both definitions are resolved by the code that
 * is running, from the same pinned document, authoring and brief, so the one
 * thing that differs between them is the overrides. The digest a release
 * stored is not consulted: the material folds values this image holds, and a
 * digest stored under an image that held others would refuse every change.
 */

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../contract/configurationSelection.ts";
import {
  draftReleaseReadiness,
  draftReleaseRefusalCode,
  type CanonicalConfiguration,
  type DraftReleaseRefusalCode,
  type ReleaseAuthoring,
  type ReleaseConfigurationFault,
} from "./authoring.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { DraftBrief } from "./ticketBrief.ts";
import {
  materialDigest,
  ticketDefinitionMaterial,
} from "./ticketDefinition.ts";

/** What one escalated ticket is resolved from, less the overrides. */
export interface ParkedTicketResolution {
  readonly configuration: CanonicalConfiguration;
  readonly configurationRepository: RepositoryId | undefined;
  readonly authoring: ReleaseAuthoring;
  readonly brief: DraftBrief | undefined;
  readonly selection?: ConfigurationSelection | undefined;
}

export type ParkedOverridesVerdict =
  | { readonly verdict: "Admitted" }
  | {
      readonly verdict: "Refused";
      readonly code: DraftReleaseRefusalCode | "OverridesMoveDefinition";
    };

/** The digest of the definition one set of overrides resolves, or the fault where the configuration it makes is not ready. */
function parkedOverridesDefinitionDigest(
  ticket: ParkedTicketResolution,
  overrides: ConfigurationOverrides | undefined,
):
  | { readonly resolved: "Resolved"; readonly digest: string }
  | {
      readonly resolved: "Unready";
      readonly fault: ReleaseConfigurationFault;
    } {
  const readiness = draftReleaseReadiness(
    ticket.configuration,
    ticket.brief,
    ticket.configurationRepository,
    overrides,
    ticket.selection,
    ticket.authoring.prog,
  );
  if (readiness.readiness === "Incomplete")
    return { resolved: "Unready", fault: readiness.fault };
  return {
    resolved: "Resolved",
    digest: materialDigest(
      ticketDefinitionMaterial({
        authoring: ticket.authoring,
        ticket: readiness.ticket,
        ...(ticket.brief === undefined ? {} : { brief: ticket.brief }),
      }),
    ),
  };
}

/**
 * Judges the offered overrides as a release judges a draft's, refusing them
 * under the code a release would be refused with — so a pairing fault, which
 * no override reaches, names the ticket rather than blaming the offer — then
 * holds the definition they resolve to the one the held overrides resolve.
 * Held overrides the running code cannot resolve give nothing to hold the
 * offer to, and the offer is refused as one that moves the definition.
 */
export function parkedOverridesVerdict(
  ticket: ParkedTicketResolution,
  held: ConfigurationOverrides | undefined,
  offered: ConfigurationOverrides,
): ParkedOverridesVerdict {
  const moved = parkedOverridesDefinitionDigest(ticket, offered);
  if (moved.resolved === "Unready")
    return { verdict: "Refused", code: draftReleaseRefusalCode(moved.fault) };
  const kept = parkedOverridesDefinitionDigest(ticket, held);
  return kept.resolved === "Resolved" && kept.digest === moved.digest
    ? { verdict: "Admitted" }
    : { verdict: "Refused", code: "OverridesMoveDefinition" };
}
